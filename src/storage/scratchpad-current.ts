import type {
  ConnectOutcome,
  JsonObject,
  MdbaseConnection,
  MdbaseOperationEnvelope,
  RecordDocument,
} from "@mdbase-dev/connect";
import {
  connectProblemFromError,
  requireConnectOutcome,
} from "../cloud/outcome";
import type { ScratchpadDocument } from "../domain/scratchpad";
import { SCRATCHPAD_TYPE } from "../domain/scratchpad";
import {
  mdbaseMutationKey,
  runMdbaseMutation,
} from "./mdbase-mutation-coordinator";
import {
  newScratchpadValues,
  scratchpadFromRecord,
  type ScratchpadRecordLike,
} from "./scratchpads";

// An untyped application record, not a note. Path uniqueness bootstraps the
// singleton; ifRevision is the authority-side compare-and-swap for transitions.
export const SCRATCHPAD_CURRENT_PATH = "TaskNotes/Scratchpad/.current.md";
const KIND = "tasknotes.scratchpad-current";

type RecordLike = RecordDocument<JsonObject>;
export interface ScratchpadCurrent {
  pointer: RecordLike;
  current: ScratchpadDocument;
}

export class ScratchpadCurrentStore {
  constructor(
    private readonly connect: MdbaseConnection<JsonObject>,
    private readonly request: () => { signal: AbortSignal },
  ) {}

  async get(
    records: () => Promise<readonly ScratchpadRecordLike[]>,
  ): Promise<ScratchpadCurrent> {
    let pointer = await this.readOptional(SCRATCHPAD_CURRENT_PATH);
    if (!pointer) {
      const notes = (await records()).map(scratchpadFromRecord);
      const active = notes
        .filter((note) => note.state === "active")
        .sort(
          (a, b) =>
            Date.parse(b.dateModified) - Date.parse(a.dateModified) ||
            Date.parse(b.dateCreated) - Date.parse(a.dateCreated) ||
            a.path.localeCompare(b.path),
        );
      const newNote = active.length ? undefined : newScratchpadValues();
      if (newNote) newNote.frontmatter.state = "converted";
      const current = active[0] ?? {
        id: String(newNote!.frontmatter.id),
        path: newNote!.path,
      };
      try {
        pointer = await this.create({
          path: SCRATCHPAD_CURRENT_PATH,
          frontmatter: {
            kind: KIND,
            transitionId: crypto.randomUUID(),
            newNote: newNote ? (newNote as unknown as JsonObject) : null,
            currentId: current.id,
            currentPath: current.path,
            pending: true,
            previousPaths: active
              .filter((note) => note.path !== current.path)
              .map((note) => note.path),
            dateChanged: new Date().toISOString(),
          },
          body: "",
        });
      } catch (reason) {
        if (!isCreateConflict(reason)) throw reason;
        pointer = await this.readOptional(SCRATCHPAD_CURRENT_PATH);
        if (!pointer) throw reason;
      }
    }
    return this.settle(pointer);
  }

  /** Commit the sole current identity before applying recoverable note flags. */
  async change(
    snapshot: ScratchpadCurrent,
    target: { id: string; path: string },
    newNote?: ReturnType<typeof newScratchpadValues>,
  ): Promise<ScratchpadCurrent> {
    const pointer = await this.update("scratchpad:current", {
      path: SCRATCHPAD_CURRENT_PATH,
      ifRevision: snapshot.pointer.revision,
      patch: {
        // Prevent revision ABA when the same pair is resumed repeatedly, even
        // if several transitions share a timestamp.
        transitionId: crypto.randomUUID(),
        currentId: target.id,
        currentPath: target.path,
        previousPaths: [snapshot.current.path],
        pending: true,
        dateChanged: new Date().toISOString(),
        newNote: newNote ? (newNote as unknown as JsonObject) : null,
      },
    });
    return this.settle(pointer);
  }

  private validate(pointer: RecordLike) {
    const fm = pointer.frontmatter;
    if (
      fm.kind !== KIND ||
      typeof fm.currentId !== "string" ||
      typeof fm.currentPath !== "string"
    )
      throw new Error(
        "The current-note record is invalid. Restore it before continuing.",
      );
    return { id: fm.currentId, path: fm.currentPath };
  }

  private async settle(initial: RecordLike): Promise<ScratchpadCurrent> {
    let pointer = initial;
    for (let attempt = 0; attempt < 12; attempt++) {
      const identity = this.validate(pointer);
      if (!pointer.frontmatter.pending) {
        const record = resultOf(
          await this.connect.read({ path: identity.path }, this.request()),
        );
        const current = scratchpadFromRecord(record);
        if (current.id !== identity.id)
          throw new Error(
            "The current note's identity changed. Reload before continuing.",
          );
        // The singleton is authoritative, even if an older client edits flags.
        return { pointer, current: { ...current, state: "active" } };
      }
      const newNote = pointer.frontmatter.newNote as
        ReturnType<typeof newScratchpadValues> | undefined;
      const previousPaths = pointer.frontmatter.previousPaths;
      if (
        !Array.isArray(previousPaths) ||
        previousPaths.some((path) => typeof path !== "string") ||
        typeof pointer.frontmatter.dateChanged !== "string"
      )
        throw new Error("The pending current-note transition is invalid.");
      try {
        if (newNote) {
          if (
            newNote.path !== identity.path ||
            typeof newNote.frontmatter.scratchpadReservationId !== "string"
          )
            throw new Error("The pending current-note transition is invalid.");
          const created = scratchpadFromRecord(
            await this.createOrRead(newNote),
          );
          if (created.id !== identity.id) {
            // mdbase's on_create UUID is authoritative. Bind that returned ID
            // to the reserved path before applying any note-state changes.
            pointer = await this.update("scratchpad:resolve-created-id", {
              path: SCRATCHPAD_CURRENT_PATH,
              ifRevision: pointer.revision,
              patch: { currentId: created.id },
            });
            continue;
          }
        }
        for (const path of previousPaths as string[]) {
          if (path === identity.path) continue;
          const previous = resultOf(
            await this.connect.read({ path }, this.request()),
          );
          if (scratchpadFromRecord(previous).state === "active") {
            await this.assertPointerRevision(pointer);
            await this.update("scratchpad:deactivate-current", {
              path,
              ifRevision: previous.revision,
              patch: {
                state: "converted",
                dateModified: pointer.frontmatter.dateChanged,
                dateConverted: pointer.frontmatter.dateChanged,
              },
            });
          }
        }
        const current = resultOf(
          await this.connect.read({ path: identity.path }, this.request()),
        );
        if (scratchpadFromRecord(current).id !== identity.id)
          throw new Error(
            "The current note's identity changed. Reload before continuing.",
          );
        if (current.frontmatter.state !== "active") {
          await this.assertPointerRevision(pointer);
          await this.update("scratchpad:activate-current", {
            path: identity.path,
            ifRevision: current.revision,
            patch: {
              state: "active",
              dateModified: pointer.frontmatter.dateChanged,
            },
          });
        }
        pointer = await this.update("scratchpad:current-settled", {
          path: SCRATCHPAD_CURRENT_PATH,
          ifRevision: pointer.revision,
          patch: { pending: null, previousPaths: null, newNote: null },
        });
      } catch (reason) {
        if (!isConflict(reason)) throw reason;
        const latest = await this.readOptional(SCRATCHPAD_CURRENT_PATH);
        if (!latest) throw reason;
        pointer = latest;
      }
    }
    throw new Error(
      "The current note is changing in another window. Reload before continuing.",
    );
  }

  private async assertPointerRevision(pointer: RecordLike) {
    const latest = await this.readOptional(SCRATCHPAD_CURRENT_PATH);
    if (latest?.revision !== pointer.revision) throw new PointerChanged();
  }

  private async readOptional(path: string): Promise<RecordLike | undefined> {
    try {
      return resultOf(await this.connect.read({ path }, this.request()));
    } catch (reason) {
      if (connectProblemFromError(reason)?.code === "file_not_found")
        return undefined;
      throw reason;
    }
  }

  private async createOrRead(
    values: ReturnType<typeof newScratchpadValues>,
  ): Promise<RecordLike> {
    const existing = await this.readOptional(values.path);
    if (existing) {
      scratchpadFromRecord(existing);
      if (
        existing.frontmatter.scratchpadReservationId !==
        values.frontmatter.scratchpadReservationId
      )
        throw new Error("The pending note's path is occupied by another note.");
      return existing;
    }
    try {
      return await this.create({
        ...values,
        frontmatter: values.frontmatter as JsonObject,
        type: SCRATCHPAD_TYPE,
      });
    } catch (reason) {
      if (!isCreateConflict(reason)) throw reason;
      const winner = await this.readOptional(values.path);
      if (!winner) throw reason;
      scratchpadFromRecord(winner);
      if (
        winner.frontmatter.scratchpadReservationId !==
        values.frontmatter.scratchpadReservationId
      )
        throw new Error(
          "The pending note's path is occupied by another note.",
          { cause: reason },
        );
      return winner;
    }
  }

  private create(
    input: Parameters<MdbaseConnection<JsonObject>["create"]>[0],
  ): Promise<RecordLike> {
    return runMdbaseMutation(
      this.connect,
      async () => resultOf(await this.connect.create(input, this.request())),
      {
        key: mdbaseMutationKey("scratchpad:create", input),
        request: this.request(),
        mapRecovered: (result: RecordLike) => result,
      },
    );
  }

  private update(
    operation: string,
    input: Parameters<MdbaseConnection<JsonObject>["update"]>[0],
  ): Promise<RecordLike> {
    return runMdbaseMutation(
      this.connect,
      async () => resultOf(await this.connect.update(input, this.request())),
      {
        key: mdbaseMutationKey(operation, input),
        request: this.request(),
        mapRecovered: (result: RecordLike) => result,
      },
    );
  }
}

function resultOf<T>(
  outcome: ConnectOutcome<T> | MdbaseOperationEnvelope<T>,
): T {
  if ("ok" in outcome) return requireConnectOutcome(outcome);
  if (!outcome.valid) throw new Error("The collection rejected this change.");
  return outcome.result;
}

// Connected-computer authorities report create path collisions as an
// operation_invalid problem with the engine's path_conflict diagnostic.
function isCreateConflict(reason: unknown): boolean {
  if (isConflict(reason)) return true;
  const problem = connectProblemFromError(reason);
  if (problem?.code !== "operation_invalid") return false;
  const details = problem.details;
  if (
    !details ||
    typeof details !== "object" ||
    !("diagnostics" in details) ||
    !Array.isArray(details.diagnostics)
  )
    return false;
  return details.diagnostics.some(
    (diagnostic) => diagnostic?.code === "path_conflict",
  );
}

class PointerChanged extends Error {}

function isConflict(reason: unknown): boolean {
  if (reason instanceof PointerChanged) return true;
  const code = connectProblemFromError(reason)?.code;
  return code === "concurrent_modification";
}
