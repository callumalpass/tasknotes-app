import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { patchTaskNotesMdbaseTypeSettings } from "@tasknotes/model/mdbase";
import { parseDocument } from "yaml";
import picomatch from "picomatch";
import type {
  PortableAuthorityRecord,
  PortableAuthorityResource,
} from "@mdbase-dev/connect-sync/adoption";
import type { AuthorityImportSnapshot } from "@mdbase-dev/connect-protocol";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { viewSourceRevision } from "./local-views";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { resolveTaskTypeDefinition } from "./tasknotes-collection";
import {
  upgradeManagedTaskDocument,
  upgradeManagedTaskType,
} from "./collection-migration";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskModelSettingsPatch } from "../domain/task-configuration";
import type { CollectionRecord } from "../domain/completion";
import type {
  CreateTaskViewSourceInput,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import type { Vault, VaultEntry } from "./vault";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORITY_STATE_PATH = ".mdbase/tasknotes-authority.json";
const AUTHORITY_SNAPSHOT_PATH = ".mdbase/tasknotes-authority-snapshot.json";

export interface ManagedTypeUpgradeRequest {
  typePath: string;
  message: string;
}

export interface LocalAuthoritySnapshot {
  collectionId: string;
  specVersion: string;
  resources: PortableAuthorityResource[];
  records: PortableAuthorityRecord[];
}

export interface LocalAuthorityFence {
  adoptionId: string;
  markHosted(): Promise<void>;
  release(): Promise<void>;
}

export class MarkdownCollection {
  private taskModel = new TaskNotesTaskModel();
  private typesFolder = "_types";
  private contractsFolder = "_contracts";
  private taskTypePath = "_types/task.md";
  private typeFingerprint = "";
  private typeDirectoryFingerprint = "";
  private declinedUpgradeFingerprint = "";
  private readonly reservedTaskPaths = new Set<string>();
  private readonly collectionRecordCache = new Map<
    string,
    {
      lastModified: number;
      size: number;
      record: CollectionRecord | null;
    }
  >();
  private authorityState: StoredAuthorityState | null = null;

  constructor(
    private readonly vault: Vault,
    private readonly options: {
      approveManagedTypeUpgrade?: (
        request: ManagedTypeUpgradeRequest,
      ) => boolean | Promise<boolean>;
    } = {},
  ) {}

  async initialize(
    options: { authorityAdoptionId?: string } = {},
  ): Promise<void> {
    await this.vault.initialize();
    await this.hydrateAuthorityState();
    this.assertAuthorityWritable(options.authorityAdoptionId);
    const defaults = defaultTaskCollectionConfiguration();
    const resources = buildTaskNotesMdbaseResources({
      profiles: ["core-lite", "recurrence", "materialized-occurrences"],
      modelConfig: {
        ...defaults,
        statuses: [
          ...defaults.statuses,
          {
            id: "cancelled",
            value: "cancelled",
            label: "Cancelled",
            color: "#808080",
            isCompleted: false,
            isSkipped: true,
            excludeFromCycle: true,
            order: defaults.statuses.length,
            autoArchive: false,
            autoArchiveDelay: 5,
          },
        ],
      },
    });
    const generatedType = structuredClone(resources.type);
    const implementation = taskNotesImplementation(generatedType);
    const extension = implementation.binding as Record<string, unknown>;
    extension.status = {
      ...(extension.status as Record<string, unknown>),
      skipped_values: ["cancelled"],
      default_skipped: "cancelled",
    };
    extension.occurrences = {
      ...(extension.occurrences as Record<string, unknown>),
      default_materialization: defaults.occurrences.defaultMaterialization,
      default_next_trigger: defaults.occurrences.defaultNextTrigger,
      past_horizon: defaults.occurrences.pastHorizon,
      future_horizon: defaults.occurrences.futureHorizon,
    };
    const generated = parseFrontmatter(resources.typeDocument);
    await this.vault.ensureText(
      resources.paths.config,
      resources.configDocument,
    );
    await Promise.all([
      this.vault.ensureText(
        resources.paths.contract,
        resources.contractDocument,
      ),
      this.vault.ensureText(
        resources.paths.taskSchema,
        resources.taskSchemaDocument,
      ),
      this.vault.ensureText(
        resources.paths.bindingSchema,
        resources.bindingSchemaDocument,
      ),
    ]);
    await this.ensureViewConfiguration(resources.paths.config);
    const definitionFolders = await this.readDefinitionFolders(
      resources.paths.config,
    );
    this.typesFolder = definitionFolders.types;
    this.contractsFolder = definitionFolders.contracts;
    const existingTypes = await this.listTypeFiles(this.typesFolder);
    if (!existingTypes.length)
      await this.vault.ensureText(
        `${this.typesFolder}/task.md`,
        serializeMarkdownDocument(generatedType, generated.body),
      );
    await this.refreshConfiguration();
  }

  async refreshConfiguration(): Promise<boolean> {
    const definitionFolders = await this.readDefinitionFolders("mdbase.yaml");
    const nextTypesFolder = definitionFolders.types;
    this.contractsFolder = definitionFolders.contracts;
    const typeFiles = await this.listTypeFiles(nextTypesFolder);
    const directoryFingerprint = typeFiles
      .map(
        ({ path, lastModified, size }) => `${path}\0${lastModified}\0${size}`,
      )
      .join("\n");
    if (
      nextTypesFolder === this.typesFolder &&
      directoryFingerprint === this.typeDirectoryFingerprint
    )
      return false;
    const matches = (
      await Promise.all(
        typeFiles.map(async (entry) => {
          const source = await this.vault.readText(entry.path);
          const parsed = parseFrontmatter(source);
          return hasTaskNotesImplementation(parsed.frontmatter)
            ? [{ entry, source, parsed }]
            : [];
        }),
      )
    ).flat();
    if (!matches.length)
      throw new Error(
        `No type implementing tasknotes.task 0.3.0-rc.1 was found in ${nextTypesFolder}/.`,
      );
    if (matches.length > 1)
      throw new Error(
        `Multiple types in ${nextTypesFolder}/ provide the TaskNotes task contract.`,
      );

    const match = matches[0];
    const sourceFingerprint = `${match.entry.path}\0${match.source}`;
    if (
      sourceFingerprint === this.typeFingerprint ||
      (sourceFingerprint === this.declinedUpgradeFingerprint &&
        this.taskTypePath === match.entry.path)
    ) {
      this.typesFolder = nextTypesFolder;
      this.typeDirectoryFingerprint = directoryFingerprint;
      return false;
    }

    let frontmatter = match.parsed.frontmatter;
    let nextFingerprint = sourceFingerprint;
    let nextDeclinedFingerprint = "";
    const upgraded = upgradeManagedTaskType(frontmatter);
    if (upgraded.changed) {
      const approved =
        sourceFingerprint !== this.declinedUpgradeFingerprint &&
        (await this.options.approveManagedTypeUpgrade?.({
          typePath: match.entry.path,
          message:
            `TaskNotes can upgrade its managed type at ${match.entry.path} ` +
            "and migrate affected task records. Continue?",
        }));
      if (approved) {
        this.taskModel = resolveTaskTypeDefinition(frontmatter).model;
        await this.upgradeDocuments(upgraded.completedField);
        frontmatter = upgraded.frontmatter;
        const upgradedSource = serializeMarkdownDocument(
          frontmatter,
          match.parsed.body,
        );
        await this.vault.writeText(match.entry.path, upgradedSource);
        nextFingerprint = `${match.entry.path}\0${upgradedSource}`;
      } else {
        nextDeclinedFingerprint = sourceFingerprint;
      }
    }

    const nextModel = resolveTaskTypeDefinition(frontmatter).model;
    this.taskModel = nextModel;
    this.declinedUpgradeFingerprint = nextDeclinedFingerprint;
    this.typeFingerprint = nextFingerprint;
    this.typesFolder = nextTypesFolder;
    this.taskTypePath = match.entry.path;
    this.typeDirectoryFingerprint = upgraded.changed
      ? ""
      : directoryFingerprint;
    this.collectionRecordCache.clear();
    return true;
  }

  async list(): Promise<VaultEntry[]> {
    const roots = new Set([this.taskModel.recordsFolderPath()]);
    const configuration = this.taskModel.configuration();
    if (configuration.archive.moveOnArchive)
      roots.add(configuration.archive.folder);
    const entries = await Promise.all(
      [...roots].map((root) =>
        this.vault.listMarkdownFiles(root).catch((reason: unknown) => {
          if (isMissingPath(reason)) return [];
          throw reason;
        }),
      ),
    );
    return [
      ...new Map(entries.flat().map((entry) => [entry.path, entry])).values(),
    ].sort((left, right) => left.path.localeCompare(right.path));
  }

  async listCollectionRecords(): Promise<CollectionRecord[]> {
    const entries = (await this.vault.listCollectionFiles([".md"])).filter(
      ({ path }) => !this.isCollectionResource(path),
    );
    this.pruneCollectionRecordCache(entries);
    await this.loadCollectionRecordEntries(
      entries.filter((entry) => !this.cachedCollectionRecord(entry)),
    );
    return entries.flatMap((entry) => {
      const record = this.collectionRecordCache.get(entry.path)?.record;
      return record ? [record] : [];
    });
  }

  async authoritySnapshot(): Promise<LocalAuthoritySnapshot> {
    const configDocument = await this.vault.readText("mdbase.yaml");
    const config = parseDocument(configDocument);
    if (config.errors.length) throw new Error(config.errors[0].message);
    const value = config.toJS() as {
      spec_version?: unknown;
      "x-mdbase-connect"?: { collection_id?: unknown };
    } | null;
    const collectionId = value?.["x-mdbase-connect"]?.collection_id;
    if (typeof collectionId !== "string" || !UUID.test(collectionId))
      throw new Error(
        "The local collection has no portable mdbase collection identity.",
      );
    const specVersion =
      typeof value?.spec_version === "string" ? value.spec_version : "0.3.0";
    const typeFiles = await this.listTypeFiles(this.typesFolder);
    const contractFiles = await this.listTypeFiles(this.contractsFolder);
    const schemaFiles = (await this.vault.listCollectionFiles([".json"]))
      .filter(({ path }) => !this.isPrivateResource(path))
      .sort((left, right) => left.path.localeCompare(right.path));
    const viewPatterns = configuredViewPatterns(value);
    const viewMatchers = viewPatterns.map((pattern) =>
      picomatch(pattern, { dot: true }),
    );
    const viewFiles = (await this.vault.listCollectionFiles([".base"]))
      .filter(({ path }) => viewMatchers.some((matches) => matches(path)))
      .sort((left, right) => left.path.localeCompare(right.path));
    const resources: PortableAuthorityResource[] = [
      {
        path: "mdbase.yaml",
        kind: "configuration",
        document: configDocument,
      },
      ...(await Promise.all(
        typeFiles.map(async ({ path }) => ({
          path,
          kind: "type" as const,
          document: await this.vault.readText(path),
        })),
      )),
      ...(await Promise.all(
        contractFiles.map(async ({ path }) => ({
          path,
          kind: "contract" as const,
          document: await this.vault.readText(path),
        })),
      )),
      ...(await Promise.all(
        schemaFiles.map(async ({ path }) => ({
          path,
          kind: "schema" as const,
          document: await this.vault.readText(path),
        })),
      )),
      ...(await Promise.all(
        viewFiles.map(async ({ path }) => ({
          path,
          kind: "view" as const,
          document: await this.vault.readText(path),
        })),
      )),
    ];
    const recordFiles = (await this.vault.listCollectionFiles([".md"])).filter(
      ({ path }) => !this.isCollectionResource(path),
    );
    const records = await Promise.all(
      recordFiles.map(async ({ path }): Promise<PortableAuthorityRecord> => {
        const document = await this.vault.readText(path);
        return {
          path,
          document,
        };
      }),
    );
    return {
      collectionId,
      specVersion,
      resources,
      records,
    };
  }

  async ensureCollectionIdentity(): Promise<string> {
    const source = await this.vault.readText("mdbase.yaml");
    const document = parseDocument(source);
    if (document.errors.length) throw new Error(document.errors[0].message);
    const existing = document.getIn(["x-mdbase-connect", "collection_id"]);
    if (typeof existing === "string" && UUID.test(existing)) return existing;
    this.assertAuthorityWritable();
    const collectionId = crypto.randomUUID();
    document.setIn(["x-mdbase-connect", "collection_id"], collectionId);
    await this.vault.writeText("mdbase.yaml", String(document));
    return collectionId;
  }

  async acquireAuthorityAdoptionFence(
    adoptionId: string,
  ): Promise<LocalAuthorityFence> {
    if (!UUID.test(adoptionId))
      throw new Error("The collection adoption identity is invalid.");
    const current =
      this.authorityState ?? readAuthorityState(this.identifier());
    if (current?.state === "hosted")
      throw new Error(
        "This local collection has already moved to hosted mdbase authority.",
      );
    if (current?.adoptionId && current.adoptionId !== adoptionId)
      throw new Error(
        "Another collection adoption is already holding the local write fence.",
      );
    await this.persistAuthorityState({
      state: "fenced",
      adoptionId,
    });
    let active = true;
    return {
      adoptionId,
      markHosted: async () => {
        if (!active) return;
        await this.persistAuthorityState({
          state: "hosted",
          adoptionId,
        });
        await this.clearAuthorityAdoptionSnapshot();
        active = false;
      },
      release: async () => {
        if (!active) return;
        const latest =
          this.authorityState ?? readAuthorityState(this.identifier());
        if (latest?.state === "fenced" && latest.adoptionId === adoptionId)
          await this.clearAuthorityState();
        active = false;
      },
    };
  }

  async persistAuthorityAdoptionSnapshot(
    adoptionId: string,
    snapshot: AuthorityImportSnapshot,
  ): Promise<void> {
    if (
      this.authorityState?.state !== "fenced" ||
      this.authorityState.adoptionId !== adoptionId
    )
      throw new Error(
        "The local authority must be fenced before its final snapshot is persisted.",
      );
    await this.vault.writeText(
      AUTHORITY_SNAPSHOT_PATH,
      JSON.stringify({ version: 1, adoptionId, snapshot }),
    );
  }

  async readAuthorityAdoptionSnapshot(
    adoptionId: string,
  ): Promise<AuthorityImportSnapshot> {
    let value: unknown;
    try {
      value = JSON.parse(await this.vault.readText(AUTHORITY_SNAPSHOT_PATH));
    } catch {
      throw new Error(
        "The exact fenced authority snapshot is missing or corrupt. Keep this source read-only.",
      );
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as { version?: unknown }).version !== 1 ||
      (value as { adoptionId?: unknown }).adoptionId !== adoptionId
    )
      throw new Error(
        "The fenced authority snapshot belongs to another adoption. Keep this source read-only.",
      );
    return (value as { snapshot: AuthorityImportSnapshot }).snapshot;
  }

  async findCollectionRecords(
    query: string,
    limit: number,
  ): Promise<CollectionRecord[]> {
    const needle = query.trim().toLocaleLowerCase();
    const entries = (await this.vault.listCollectionFiles([".md"])).filter(
      ({ path }) => !this.isCollectionResource(path),
    );
    this.pruneCollectionRecordCache(entries);
    const matches = new Map<string, CollectionRecord>();
    const stale: VaultEntry[] = [];
    for (const entry of entries) {
      const cached = this.cachedCollectionRecord(entry);
      if (!cached) {
        stale.push(entry);
        continue;
      }
      if (cached.record && recordMatchesSearch(cached.record, needle))
        matches.set(entry.path, cached.record);
    }
    for (const batch of batches(stale, 64)) {
      await this.loadCollectionRecordEntries(batch);
      for (const entry of batch) {
        const record = this.collectionRecordCache.get(entry.path)?.record;
        if (record && recordMatchesSearch(record, needle))
          matches.set(entry.path, record);
      }
      if (matches.size >= limit) break;
    }
    return [...matches.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, limit);
  }

  listViewSources(): Promise<VaultEntry[]> {
    return this.vault.listFiles("views", [".base"]);
  }

  readText(path: string): Promise<string> {
    return this.vault.readText(path);
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    assertLocalViewPath(path);
    const document = await this.vault.readText(path);
    validateBaseDocument(document);
    return {
      path,
      format: "obsidian.base",
      revision: await viewSourceRevision(document),
      document,
    };
  }

  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    this.assertAuthorityWritable();
    if (input.format && input.format !== "obsidian.base")
      throw new Error(`Unsupported saved-view format: ${input.format}`);
    validateBaseDocument(input.document);
    const path = input.path ?? `views/${viewSlug(input.name ?? "view")}.base`;
    assertLocalViewPath(path);
    if (await this.vault.exists(path))
      throw new Error(`A saved view already exists at ${path}.`);
    await this.vault.writeText(path, input.document);
    return this.readViewSource(path);
  }

  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    this.assertAuthorityWritable();
    const current = await this.readViewSource(input.path);
    if (input.ifRevision && input.ifRevision !== current.revision)
      throw new Error(
        "This view changed after it was opened. Reload it before saving.",
      );
    validateBaseDocument(input.document);
    await this.vault.writeText(input.path, input.document);
    return this.readViewSource(input.path);
  }

  async deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    this.assertAuthorityWritable();
    const current = await this.readViewSource(path);
    if (ifRevision && ifRevision !== current.revision)
      throw new Error(
        "This view changed after it was opened. Reload it before deleting.",
      );
    await this.vault.delete(path);
  }

  async read(document: VaultEntry): Promise<Task | null> {
    const source = await this.vault.readText(document.path);
    try {
      const parsed = parseFrontmatter(source);
      const task = this.taskModel.read({
        path: document.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      });
      this.cacheTaskRecord(task, document);
      return task;
    } catch {
      return null;
    }
  }

  cacheTaskRecord(
    task: Task,
    source: Pick<VaultEntry, "lastModified" | "size">,
  ): void {
    this.collectionRecordCache.set(task.path, {
      lastModified: source.lastModified,
      size: source.size,
      record: taskCollectionRecord(task),
    });
  }

  private async readCollectionRecord(
    document: VaultEntry,
  ): Promise<CollectionRecord | null> {
    const source = await this.vault.readText(document.path);
    try {
      const parsed = parseFrontmatter(source);
      const types = explicitRecordTypes(parsed.frontmatter);
      try {
        this.taskModel.read({
          path: document.path,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
        if (!types.includes("task")) types.push("task");
      } catch {
        // Other Markdown records remain available to links and project views.
      }
      return {
        path: document.path,
        label: recordLabelForPath(parsed.frontmatter, document.path),
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        types,
      };
    } catch {
      return null;
    }
  }

  async createTask(
    input: CreateTaskInput,
    id: string,
    now: string,
  ): Promise<Task> {
    const task = await this.taskModel.createWithTemplate(
      input,
      { id, now },
      (path) => this.vault.readText(path),
    );
    const path = await this.availableTaskPath(task.path);
    return path === task.path ? task : { ...task, path };
  }

  updateTask(task: Task, input: UpdateTaskInput, now: string): Task {
    return this.taskModel.update(task, input, { now });
  }

  toggleTask(task: Task, now: string, currentDate?: string): Task {
    return this.taskModel.toggle(task, { now, currentDate });
  }

  skipTask(task: Task, now: string, currentDate: string): Task {
    return this.taskModel.skip(task, { now, currentDate });
  }

  async materializeOccurrence(
    parent: Task,
    targetDate: string,
    existingOccurrences: readonly Task[],
    id: string,
    now: string,
  ): Promise<MaterializeOccurrenceResult> {
    const result = await this.taskModel.materializeOccurrence(
      parent,
      targetDate,
      existingOccurrences,
      { id, now },
      (path) => this.vault.readText(path),
    );
    if (!result.created) return result;
    const path = await this.availableTaskPath(result.task.path);
    return path === result.task.path
      ? result
      : { ...result, task: { ...result.task, path } };
  }

  transitionMaterializedOccurrence(
    occurrence: Task,
    parent: Task,
    action: "toggle" | "skip",
    now: string,
  ) {
    return this.taskModel.transitionMaterializedOccurrence(
      occurrence,
      parent,
      action,
      { now },
    );
  }

  startTimeTracking(task: Task, now: string, description?: string): Task {
    return this.taskModel.startTimeTracking(task, { now, description });
  }

  stopTimeTracking(task: Task, now: string): Task {
    return this.taskModel.stopTimeTracking(task, { now });
  }

  replaceTimeEntries(task: Task, entries: TaskTimeEntry[], now: string): Task {
    return this.taskModel.replaceTimeEntries(task, entries, { now });
  }

  removeTimeEntry(task: Task, index: number, now: string): Task {
    return this.taskModel.removeTimeEntry(task, index, { now });
  }

  taskConfiguration(): TaskCollectionConfiguration {
    return this.taskModel.configuration();
  }

  taskModelSettingsSource(): string {
    return this.taskTypePath;
  }

  async updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration> {
    this.assertAuthorityWritable();
    const source = parseFrontmatter(
      await this.vault.readText(this.taskTypePath),
    );
    const frontmatter = patchTaskNotesMdbaseTypeSettings(
      source.frontmatter,
      patch,
    );
    await this.vault.writeText(
      this.taskTypePath,
      serializeMarkdownDocument(frontmatter, source.body),
    );
    await this.refreshConfiguration();
    return this.taskConfiguration();
  }

  async write(task: Task): Promise<VaultEntry> {
    this.assertAuthorityWritable();
    const source = await this.vault.writeText(
      task.path,
      serializeMarkdownDocument(task.frontmatter, task.body),
    );
    this.cacheTaskRecord(task, source);
    return source;
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
    this.assertAuthorityWritable();
    const source = await this.vault.rename(from, to);
    const cached = this.collectionRecordCache.get(from);
    this.collectionRecordCache.delete(from);
    if (cached?.record)
      this.collectionRecordCache.set(to, {
        lastModified: source.lastModified,
        size: source.size,
        record: {
          ...cached.record,
          path: to,
          label: recordLabelForPath(cached.record.frontmatter, to),
        },
      });
    return source;
  }

  archiveDestination(task: Task, archived: boolean): string | undefined {
    return this.taskModel.archiveDestination(task, archived);
  }

  async delete(path: string): Promise<void> {
    this.assertAuthorityWritable();
    await this.vault.delete(path);
    this.collectionRecordCache.delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.vault.exists(path);
  }

  private async availableTaskPath(path: string): Promise<string> {
    const pathExists = await this.vault.exists(path);
    if (!pathExists && !this.reservedTaskPaths.has(path)) {
      this.reservedTaskPaths.add(path);
      return path;
    }
    const extension = /\.md$/i.test(path) ? ".md" : "";
    const stem = extension ? path.slice(0, -extension.length) : path;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${stem}-${index}${extension}`;
      const candidateExists = await this.vault.exists(candidate);
      if (!candidateExists && !this.reservedTaskPaths.has(candidate)) {
        this.reservedTaskPaths.add(candidate);
        return candidate;
      }
    }
    throw new Error(
      "task_path_collision: Could not allocate a unique task path.",
    );
  }

  location(): string {
    return this.vault.location();
  }

  identifier(): string {
    return this.vault.identifier();
  }

  kind(): Vault["kind"] {
    return this.vault.kind;
  }

  private assertAuthorityWritable(authorityAdoptionId?: string): void {
    const state = this.authorityState ?? readAuthorityState(this.identifier());
    if (!state) return;
    if (state.state === "fenced" && state.adoptionId === authorityAdoptionId)
      return;
    throw new Error(
      state.state === "hosted"
        ? "This local collection is an archived source. Hosted mdbase is now authoritative."
        : "This local collection is temporarily read-only while hosted authority activates.",
    );
  }

  private async hydrateAuthorityState(): Promise<void> {
    let persisted: StoredAuthorityState | null = null;
    if (await this.vault.exists(AUTHORITY_STATE_PATH)) {
      try {
        const value = JSON.parse(
          await this.vault.readText(AUTHORITY_STATE_PATH),
        ) as Partial<StoredAuthorityState>;
        if (
          (value.state === "fenced" || value.state === "hosted") &&
          typeof value.adoptionId === "string" &&
          UUID.test(value.adoptionId)
        )
          persisted = value as StoredAuthorityState;
        else throw new Error("invalid marker");
      } catch {
        throw new Error(
          "The local authority marker is corrupt. Keep this collection read-only until it is repaired.",
        );
      }
    }
    const local = readAuthorityState(this.identifier());
    if (
      persisted &&
      local &&
      (persisted.state !== local.state ||
        persisted.adoptionId !== local.adoptionId)
    )
      throw new Error(
        "Local authority checkpoints disagree. Keep this collection read-only until the adoption is resolved.",
      );
    this.authorityState = persisted ?? local;
    if (this.authorityState)
      writeAuthorityState(this.identifier(), this.authorityState);
  }

  private async persistAuthorityState(
    state: StoredAuthorityState,
  ): Promise<void> {
    await this.vault.writeText(
      AUTHORITY_STATE_PATH,
      `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`,
    );
    writeAuthorityState(this.identifier(), state);
    this.authorityState = state;
  }

  private async clearAuthorityState(): Promise<void> {
    if (await this.vault.exists(AUTHORITY_STATE_PATH))
      await this.vault.delete(AUTHORITY_STATE_PATH);
    clearAuthorityState(this.identifier());
    this.authorityState = null;
    await this.clearAuthorityAdoptionSnapshot();
  }

  private async clearAuthorityAdoptionSnapshot(): Promise<void> {
    if (await this.vault.exists(AUTHORITY_SNAPSHOT_PATH))
      await this.vault.delete(AUTHORITY_SNAPSHOT_PATH);
  }

  private cachedCollectionRecord(
    entry: VaultEntry,
  ):
    | { lastModified: number; size: number; record: CollectionRecord | null }
    | undefined {
    const cached = this.collectionRecordCache.get(entry.path);
    return cached?.lastModified === entry.lastModified &&
      cached.size === entry.size
      ? cached
      : undefined;
  }

  private pruneCollectionRecordCache(entries: readonly VaultEntry[]): void {
    const paths = new Set(entries.map(({ path }) => path));
    for (const path of this.collectionRecordCache.keys())
      if (!paths.has(path)) this.collectionRecordCache.delete(path);
  }

  private async loadCollectionRecordEntries(
    entries: readonly VaultEntry[],
  ): Promise<void> {
    for (const batch of batches([...entries], 64)) {
      const loaded = await Promise.all(
        batch.map((entry) => this.readCollectionRecord(entry)),
      );
      for (let index = 0; index < batch.length; index += 1) {
        const entry = batch[index];
        this.collectionRecordCache.set(entry.path, {
          lastModified: entry.lastModified,
          size: entry.size,
          record: loaded[index],
        });
      }
    }
  }

  private async upgradeDocuments(completedField: string): Promise<void> {
    const documents = await this.list();
    for (const batch of batches(documents, 64)) {
      await Promise.all(
        batch.map(async (document) => {
          try {
            const parsed = parseFrontmatter(
              await this.vault.readText(document.path),
            );
            const upgraded = upgradeManagedTaskDocument(
              parsed.frontmatter,
              completedField,
            );
            if (upgraded.changed)
              await this.vault.writeText(
                document.path,
                serializeMarkdownDocument(upgraded.frontmatter, parsed.body),
              );
          } catch {
            // Invalid user records remain untouched and are omitted from the index.
          }
        }),
      );
    }
  }

  private async ensureViewConfiguration(configPath: string): Promise<void> {
    const source = await this.vault.readText(configPath);
    const document = parseDocument(source);
    if (document.hasIn(["x-obsidian", "bases"])) return;
    document.setIn(["x-obsidian", "bases"], {
      include: ["views/**/*.base"],
      create_folder: "views",
      default_for_new_views: true,
    });
    await this.vault.writeText(configPath, String(document));
  }

  private async readDefinitionFolders(
    configPath: string,
  ): Promise<{ types: string; contracts: string }> {
    const source = await this.vault.readText(configPath);
    const document = parseDocument(source);
    if (document.errors.length) throw new Error(document.errors[0].message);
    const value = document.toJS() as {
      settings?: {
        types_folder?: unknown;
        typesFolder?: unknown;
        contracts_folder?: unknown;
        contractsFolder?: unknown;
      };
    } | null;
    const configuredTypes =
      value?.settings?.types_folder ?? value?.settings?.typesFolder;
    const configuredContracts =
      value?.settings?.contracts_folder ?? value?.settings?.contractsFolder;
    return {
      types:
        typeof configuredTypes === "string" && configuredTypes.trim()
          ? normalizeResourceFolder(configuredTypes)
          : "_types",
      contracts:
        typeof configuredContracts === "string" && configuredContracts.trim()
          ? normalizeResourceFolder(configuredContracts)
          : "_contracts",
    };
  }

  private listTypeFiles(folder: string): Promise<VaultEntry[]> {
    return this.vault.listMarkdownFiles(folder).catch((reason: unknown) => {
      if (isMissingPath(reason)) return [];
      throw reason;
    });
  }

  private isCollectionResource(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").toLocaleLowerCase();
    const typeRoot = `${this.typesFolder.toLocaleLowerCase()}/`;
    const contractRoot = `${this.contractsFolder.toLocaleLowerCase()}/`;
    return (
      normalized.startsWith(typeRoot) ||
      normalized.includes(`/${typeRoot}`) ||
      normalized.startsWith(contractRoot) ||
      normalized.includes(`/${contractRoot}`) ||
      this.isPrivateResource(normalized)
    );
  }

  private isPrivateResource(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").toLocaleLowerCase();
    return (
      normalized.startsWith(".mdbase/") ||
      normalized.startsWith("node_modules/")
    );
  }
}

function assertLocalViewPath(path: string): void {
  if (
    !path.startsWith("views/") ||
    !path.endsWith(".base") ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    throw new Error("Saved views must be .base files inside views/.");
  }
}

function validateBaseDocument(source: string): void {
  const parsed = parseDocument(source);
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const value = parsed.toJS() as { views?: unknown } | null;
  if (!value || !Array.isArray(value.views))
    throw new Error("A saved-view source requires a views list.");
}

function viewSlug(value: string): string {
  const slug = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "view";
}

export function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size));
  return result;
}

function taskCollectionRecord(task: Task): CollectionRecord {
  return {
    path: task.path,
    label: recordLabelForPath(task.frontmatter, task.path),
    frontmatter: task.frontmatter,
    body: task.body,
    types: ["task"],
  };
}

function recordLabelForPath(
  frontmatter: Record<string, unknown>,
  path: string,
): string {
  const title = frontmatter.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
}

function recordMatchesSearch(record: CollectionRecord, query: string): boolean {
  if (!query) return true;
  const aliases = record.frontmatter.aliases;
  const search = [
    record.path,
    record.label,
    ...(Array.isArray(aliases)
      ? aliases.filter((value): value is string => typeof value === "string")
      : typeof aliases === "string"
        ? [aliases]
        : []),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => search.includes(token));
}

function explicitRecordTypes(frontmatter: Record<string, unknown>): string[] {
  const values = [
    ...(typeof frontmatter.type === "string" ? [frontmatter.type] : []),
    ...(Array.isArray(frontmatter.types)
      ? frontmatter.types.filter(
          (value): value is string => typeof value === "string",
        )
      : []),
  ];
  return [
    ...new Set(
      values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean),
    ),
  ];
}

function taskNotesImplementation(
  type: Record<string, unknown>,
): Record<string, unknown> {
  const implementation = Array.isArray(type.implements)
    ? type.implements.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).contract ===
            "tasknotes.task" &&
          (candidate as Record<string, unknown>).version === "0.3.0-rc.1",
      )
    : undefined;
  if (!implementation)
    throw new Error(
      "The generated type does not implement tasknotes.task 0.3.0-rc.1.",
    );
  return implementation as Record<string, unknown>;
}

function hasTaskNotesImplementation(type: Record<string, unknown>): boolean {
  try {
    taskNotesImplementation(type);
    return true;
  } catch {
    return false;
  }
}

function isMissingPath(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "NotFoundError") ||
    /not exist|not found/i.test(String(reason))
  );
}

function normalizeResourceFolder(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("The mdbase types folder is unsafe.");
  return normalized;
}

function configuredViewPatterns(configuration: unknown): string[] {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  )
    return [];
  const obsidian = (configuration as Record<string, unknown>)["x-obsidian"];
  if (!obsidian || typeof obsidian !== "object" || Array.isArray(obsidian))
    return [];
  const bases = (obsidian as Record<string, unknown>).bases;
  if (!bases || typeof bases !== "object" || Array.isArray(bases)) return [];
  const include = (bases as Record<string, unknown>).include;
  return Array.isArray(include)
    ? include.filter((entry): entry is string => typeof entry === "string")
    : [];
}

interface StoredAuthorityState {
  state: "fenced" | "hosted";
  adoptionId: string;
}

function authorityStateKey(identifier: string): string {
  return `tasknotes:local-authority:${identifier}`;
}

function readAuthorityState(identifier: string): StoredAuthorityState | null {
  try {
    const value = JSON.parse(
      globalThis.localStorage?.getItem(authorityStateKey(identifier)) ?? "null",
    ) as Partial<StoredAuthorityState> | null;
    return value &&
      (value.state === "fenced" || value.state === "hosted") &&
      typeof value.adoptionId === "string"
      ? (value as StoredAuthorityState)
      : null;
  } catch {
    return null;
  }
}

function writeAuthorityState(
  identifier: string,
  state: StoredAuthorityState,
): void {
  globalThis.localStorage?.setItem(
    authorityStateKey(identifier),
    JSON.stringify(state),
  );
}

function clearAuthorityState(identifier: string): void {
  globalThis.localStorage?.removeItem(authorityStateKey(identifier));
}
