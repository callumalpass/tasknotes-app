/**
 * One app's collection-scope settings record (mdbase.app-settings 1.0.0),
 * modelled on mdbase Reader's store: read by path, defaults when it is
 * missing, created on the first save, then patched field by field against the
 * revision that was read. Nothing here creates the record on read or rewrites
 * it to repair a field: an unusable field takes its default with a warning
 * until someone saves it.
 *
 * The store is storage-neutral. Each repository supplies a port over its own
 * client and says how that client's failures read: a missing record, a
 * refusal for lack of access, or a race with another writer.
 */
import {
  appSettingsPatch,
  appSettingsPath,
  conflictingAppSettings,
  defaultAppSettings,
  newAppSettingsFrontmatter,
  resolveAppSettings,
  type AppSettingsChanges,
  type AppSettingsDefinition,
  type ResolvedAppSettings,
} from "@tasknotes/model/settings";

export interface AppSettingsRecord {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly revision?: string;
}

/** How a port failure reads. Anything else is a plain failure. */
export type AppSettingsFailure = "not_found" | "read_only" | "raced";

export interface AppSettingsRecordPort {
  /** The record, or null when there is none (a `not_found` failure also means none). */
  read(path: string, signal?: AbortSignal): Promise<AppSettingsRecord | null>;
  create(
    input: {
      path: string;
      type: string;
      frontmatter: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<AppSettingsRecord>;
  /** `patch` sets fields; a null value removes the field. */
  update(
    input: {
      path: string;
      revision?: string;
      patch: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<AppSettingsRecord>;
  classify(reason: unknown): AppSettingsFailure | undefined;
}

export interface AppSettingsSnapshot<Values extends object> {
  /** `loading` until the first read, `failed` when it could not be read: defaults apply. */
  readonly status: "loading" | "ready" | "failed";
  readonly settings: ResolvedAppSettings<Values>;
  /** The record's frontmatter as read; undefined when there is no record (yet). */
  readonly frontmatter?: Readonly<Record<string, unknown>>;
  readonly revision?: string;
  readonly problem?: string;
}

export type AppSettingsSaveResult<Values extends object> =
  | { readonly ok: true; readonly snapshot: AppSettingsSnapshot<Values> }
  | {
      readonly ok: false;
      /**
       * `conflict`: someone else changed `fields` since the save was prepared;
       * nothing was written. `read_only`: this client may not change these
       * settings. `failed`: anything else.
       */
      readonly reason: "conflict" | "read_only" | "failed";
      readonly message: string;
      readonly fields?: readonly string[];
      readonly snapshot: AppSettingsSnapshot<Values>;
    };

export const APP_SETTINGS_READ_ONLY_MESSAGE =
  "This connection cannot change the collection's settings.";
export const APP_SETTINGS_CONFLICT_MESSAGE =
  "These settings were changed somewhere else. Review them and save again.";

export class AppSettingsStore<Values extends object> {
  readonly path: string;
  #snapshot: AppSettingsSnapshot<Values>;
  /** Set when a write was refused for lack of access; it holds for this store. */
  #refused: string | undefined;

  constructor(
    private readonly port: AppSettingsRecordPort,
    private readonly definition: AppSettingsDefinition<Values>,
  ) {
    this.path = appSettingsPath(definition.app);
    this.#snapshot = {
      status: "loading",
      settings: defaultAppSettings(definition),
    };
  }

  getSnapshot(): AppSettingsSnapshot<Values> {
    return this.#snapshot;
  }

  /** The settings as last read, reading them first when they have not been. */
  async current(signal?: AbortSignal): Promise<AppSettingsSnapshot<Values>> {
    return this.#snapshot.status === "ready"
      ? this.#snapshot
      : this.reload(signal);
  }

  /** Read the record again. A read failure gives defaults, read-only. */
  async reload(signal?: AbortSignal): Promise<AppSettingsSnapshot<Values>> {
    // No record: the defaults. The first save creates it, never a read.
    const missing = () =>
      this.#withRefusal({
        status: "ready",
        settings: defaultAppSettings(this.definition),
      });
    let snapshot: AppSettingsSnapshot<Values>;
    try {
      const record = await this.port.read(this.path, signal);
      snapshot = record ? this.#resolved(record) : missing();
    } catch (reason) {
      signal?.throwIfAborted();
      snapshot =
        this.port.classify(reason) === "not_found"
          ? missing()
          : this.#failed(message(reason, "The settings could not be read."));
    }
    this.#snapshot = snapshot;
    return snapshot;
  }

  /**
   * Save `changes`: a value per changed setting, or null to go back to its
   * default. `prepared` is the snapshot the changes were made against
   * (default: the settings as now read); a setting someone else changed since
   * then is a conflict, and nothing is written. A write that races another
   * writer is read again and retried once.
   */
  async save(
    changes: AppSettingsChanges<Values>,
    prepared?: AppSettingsSnapshot<Values>,
    signal?: AbortSignal,
  ): Promise<AppSettingsSaveResult<Values>> {
    let latest = await this.current(signal);
    const base = (prepared ?? latest).frontmatter;
    for (let attempt = 0; ; attempt += 1) {
      const refused = this.#refuseBefore(latest, base, changes);
      if (refused) return refused;
      const written = await this.#write(latest, changes, signal);
      if (!("raced" in written)) return written;
      if (attempt > 0) return this.#refusal("failed", written.raced);
      // Someone else created or changed the record first: read it, go again once.
      latest = await this.reload(signal);
    }
  }

  #refuseBefore(
    latest: AppSettingsSnapshot<Values>,
    base: Readonly<Record<string, unknown>> | undefined,
    changes: AppSettingsChanges<Values>,
  ): AppSettingsSaveResult<Values> | undefined {
    if (latest.status === "failed")
      return this.#refusal(
        "failed",
        latest.problem ?? "The settings could not be read.",
      );
    if (latest.settings.readOnly)
      return this.#refusal("read_only", latest.settings.readOnly);
    const conflicts = conflictingAppSettings(
      this.definition,
      base,
      latest.frontmatter ?? {},
      changes,
    );
    return conflicts.length
      ? this.#refusal("conflict", APP_SETTINGS_CONFLICT_MESSAGE, conflicts)
      : undefined;
  }

  async #write(
    latest: AppSettingsSnapshot<Values>,
    changes: AppSettingsChanges<Values>,
    signal?: AbortSignal,
  ): Promise<AppSettingsSaveResult<Values> | { readonly raced: string }> {
    let record: AppSettingsRecord;
    try {
      if (latest.frontmatter) {
        const patch = appSettingsPatch(
          this.definition,
          latest.frontmatter,
          changes,
        );
        if (!Object.keys(patch).length) return { ok: true, snapshot: latest };
        record = await this.port.update(
          {
            path: this.path,
            ...(latest.revision ? { revision: latest.revision } : {}),
            patch,
          },
          signal,
        );
      } else {
        const frontmatter = newAppSettingsFrontmatter(this.definition, changes);
        record = await this.port.create(
          { path: this.path, type: this.definition.type, frontmatter },
          signal,
        );
      }
    } catch (reason) {
      signal?.throwIfAborted();
      const failure = this.port.classify(reason);
      if (failure === "read_only") {
        this.#refused = APP_SETTINGS_READ_ONLY_MESSAGE;
        this.#snapshot = this.#withRefusal(this.#snapshot);
        return this.#refusal("read_only", this.#refused);
      }
      const text = message(reason, "The settings could not be saved.");
      return failure === "raced"
        ? { raced: text }
        : this.#refusal("failed", text);
    }
    this.#snapshot = this.#resolved(record);
    return { ok: true, snapshot: this.#snapshot };
  }

  #resolved(record: AppSettingsRecord): AppSettingsSnapshot<Values> {
    return this.#withRefusal({
      status: "ready",
      settings: resolveAppSettings(this.definition, record.frontmatter),
      frontmatter: record.frontmatter,
      ...(record.revision ? { revision: record.revision } : {}),
    });
  }

  #failed(problem: string): AppSettingsSnapshot<Values> {
    return {
      status: "failed",
      settings: { ...defaultAppSettings(this.definition), readOnly: problem },
      problem,
    };
  }

  #withRefusal(
    snapshot: AppSettingsSnapshot<Values>,
  ): AppSettingsSnapshot<Values> {
    return this.#refused && !snapshot.settings.readOnly
      ? {
          ...snapshot,
          settings: { ...snapshot.settings, readOnly: this.#refused },
        }
      : snapshot;
  }

  #refusal(
    reason: "conflict" | "read_only" | "failed",
    text: string,
    fields?: readonly string[],
  ): AppSettingsSaveResult<Values> {
    return {
      ok: false,
      reason,
      message: text,
      ...(fields ? { fields } : {}),
      snapshot: this.#snapshot,
    };
  }
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
