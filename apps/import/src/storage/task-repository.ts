import {
  type MdbaseClient,
  type MdbaseApplicationConnection,
  type Receipt,
} from "@mdbase-dev/sdk";
import { importedIdentity, type PlannedTask } from "../plan";
import { discoverTypes } from "../destination";
import type { ImportReport, TaskRepository } from "../task-repository";
export type ImportConnection = Pick<
  MdbaseClient,
  | "pages"
  | "create"
  | "pendingWrites"
  | "awaitReceipt"
  | "get"
  | "ledger"
  | "describe"
>;

export function receiptProblem(receipt: Receipt): string {
  return (
    receipt.problem?.message ||
    `Write is ${receipt.state}. Check the original mutation before importing again.`
  );
}

export async function runImport(
  connection: ImportConnection,
  plan: readonly PlannedTask[],
  onProgress: (report: ImportReport[]) => void,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<ImportReport[]> {
  if (!plan.length || plan.some((t) => t.errors.length))
    throw new Error("Review and resolve blocked tasks before importing.");
  if (new Set(plan.map((p) => p.identity)).size !== plan.length)
    throw new Error("Import plan contains duplicate source identities.");
  const ledger = connection.ledger.getSnapshot();
  if (
    !ledger.restored ||
    ledger.pending.length ||
    ledger.rejected.length ||
    (await connection.pendingWrites()).length
  )
    throw new Error(
      "A previous write needs recovery. Check its original mutation before importing again.",
    );
  const report: ImportReport[] = plan.map((p) => ({
    sourceId: p.sourceId,
    path: p.path,
    status: "not-started",
  }));
  const publish = () => onProgress(report.map((r) => ({ ...r })));
  const identities = new Map<string, string>();
  const paths = new Set<string>();
  // Read every native page, including bodies; stale cursors fail closed (no restart).
  for await (const page of connection.pages({}, { include: { body: true } })) {
    for (const record of page.records) {
      paths.add(record.path.toLocaleLowerCase());
      if (record.body === undefined)
        throw new Error(
          "The destination did not return record bodies. Duplicate checking cannot proceed safely.",
        );
      if (
        record.state.state !== "confirmed" ||
        record.state.hold ||
        record.state.unresolved
      )
        throw new Error(
          "Resolve pending or conflicted destination records before importing.",
        );
      const id = importedIdentity(record.body);
      if (id) {
        if (identities.has(id))
          throw new Error(
            "The collection already contains duplicate Todoist imports. Resolve them before continuing.",
          );
        identities.set(id, record.path);
      }
    }
    if (!page.complete && !page.cursor)
      throw new Error(
        "The destination duplicate scan was incomplete. No tasks were imported.",
      );
  }
  // Preflight all collisions before making any writes. Native create also refuses path races.
  for (const task of plan)
    if (
      !identities.has(task.identity) &&
      paths.has(task.path.toLocaleLowerCase())
    )
      throw new Error(
        `An unrelated record occupies ${task.path}. No tasks were imported.`,
      );
  publish();
  for (const [index, task] of plan.entries()) {
    if (signal?.aborted) break; // Never abort a captured write: wait for its authoritative outcome.
    if (!isCurrent())
      throw new Error("The destination changed. Preview again.");
    const previousPath = identities.get(task.identity);
    if (previousPath) {
      report[index] = {
        ...report[index],
        path: previousPath,
        status: "skipped",
        message: "Already imported; existing record left unchanged.",
      };
      publish();
      continue;
    }
    try {
      const write = await connection.create({
        path: task.path,
        type: task.type,
        frontmatter: task.frontmatter,
        body: task.body,
      });
      // Keep the original SDK identity even if confirmation/readback fails.
      report[index].mutationId = write.mutationId;
      publish();
      const receipt =
        write.state === "pending"
          ? await connection.awaitReceipt(write.mutationId, {
              timeoutMs: 30_000,
            })
          : write.receipt;
      if (receipt.state !== "confirmed") {
        report[index] = {
          ...report[index],
          status: receipt.state === "rejected" ? "failed" : "uncertain",
          message: receiptProblem(receipt),
        };
        publish();
        break;
      }
      const id = receipt.records?.[0]?.id ?? write.records[0]?.id;
      if (!id) throw new Error("Confirmed write has no record identity.");
      const record = await connection.get(id, { include: { body: true } });
      if (
        record.id !== id ||
        record.state.state !== "confirmed" ||
        record.state.hold ||
        record.state.unresolved ||
        importedIdentity(record.body ?? "") !== task.identity
      )
        throw new Error(
          "The confirmed import could not be verified. Check its original mutation.",
        );
      report[index] = {
        ...report[index],
        path: record.path,
        status: "created",
      };
      identities.set(task.identity, record.path);
    } catch (error) {
      const mutationId =
        error &&
        typeof error === "object" &&
        "mutationId" in error &&
        typeof error.mutationId === "string"
          ? error.mutationId
          : report[index].mutationId;
      report[index] = {
        ...report[index],
        mutationId,
        status: "uncertain",
        message:
          "Write outcome could not be verified. Check the original mutation; do not submit a replacement write.",
      };
      publish();
      break;
    }
    publish();
  }
  return report;
}

export class MdbaseTaskRepository implements TaskRepository {
  constructor(
    private readonly connection: Pick<
      MdbaseApplicationConnection,
      "records" | "isCurrent"
    >,
  ) {}

  isCurrent() {
    return this.connection.isCurrent();
  }

  async discoverTypes() {
    this.assertCurrent();
    const description = await this.connection.records.describe({
      definitions: true,
    });
    this.assertCurrent();
    return discoverTypes(description);
  }

  async importTasks(
    plan: readonly PlannedTask[],
    onProgress: (report: ImportReport[]) => void,
    signal?: AbortSignal,
  ) {
    this.assertCurrent();
    return runImport(this.connection.records, plan, onProgress, signal, () =>
      this.isCurrent(),
    );
  }

  async recoverWrites(
    mutationIds: readonly string[],
    plan: readonly PlannedTask[],
    report: readonly ImportReport[],
    onProgress: (report: ImportReport[]) => void,
  ) {
    this.assertCurrent();
    let recovered = report.map((row) => ({ ...row }));
    const client = this.connection.records;
    for (const mutationId of mutationIds) {
      const receipt = await client.awaitReceipt(mutationId, {
        timeoutMs: 30_000,
      });
      if (receipt.state !== "confirmed" && receipt.state !== "rejected")
        throw new Error(receiptProblem(receipt));
      if (receipt.state === "rejected") {
        await client.ledger.acknowledge(mutationId);
        recovered = recovered.map((row) =>
          row.mutationId === mutationId
            ? { ...row, status: "failed", message: receiptProblem(receipt) }
            : row,
        );
        onProgress(recovered);
      } else {
        const row = recovered.find((entry) => entry.mutationId === mutationId);
        if (!row) continue;
        const task = plan.find((entry) => entry.sourceId === row.sourceId);
        const id = receipt.records?.[0]?.id;
        if (!task || !id)
          throw new Error(
            "Original write confirmed. Inspect the destination before starting a new preview.",
          );
        const record = await client.get(id, { include: { body: true } });
        if (
          record.id !== id ||
          record.state.state !== "confirmed" ||
          record.state.hold ||
          record.state.unresolved ||
          importedIdentity(record.body ?? "") !== task.identity
        )
          throw new Error(
            "The original write is confirmed but its imported record could not be verified.",
          );
        recovered = recovered.map((entry) =>
          entry.mutationId === mutationId
            ? {
                ...entry,
                status: "created",
                path: record.path,
                message:
                  "Original write confirmed and verified; no replacement write submitted.",
              }
            : entry,
        );
        onProgress(recovered);
      }
    }
  }

  private assertCurrent() {
    if (!this.isCurrent())
      throw new Error("The destination changed. Preview again.");
  }
}
