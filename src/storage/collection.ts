import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { parseDocument } from "yaml";

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
import type { CollectionRecord } from "../domain/completion";
import type {
  CreateTaskViewSourceInput,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import type { Vault, VaultEntry } from "./vault";

export interface ManagedTypeUpgradeRequest {
  typePath: string;
  message: string;
}

export class MarkdownCollection {
  private taskModel = new TaskNotesTaskModel();
  private typesFolder = "_types";
  private taskTypePath = "_types/task.md";
  private typeFingerprint = "";
  private typeDirectoryFingerprint = "";
  private declinedUpgradeFingerprint = "";
  private readonly collectionRecordCache = new Map<
    string,
    {
      lastModified: number;
      size: number;
      record: CollectionRecord | null;
    }
  >();

  constructor(
    private readonly vault: Vault,
    private readonly options: {
      approveManagedTypeUpgrade?: (
        request: ManagedTypeUpgradeRequest,
      ) => boolean | Promise<boolean>;
    } = {},
  ) {}

  async initialize(): Promise<void> {
    await this.vault.initialize();
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
    const extension = generatedType["x-tasknotes"] as Record<string, unknown>;
    extension.status = {
      ...(extension.status as Record<string, unknown>),
      skipped_values: ["cancelled"],
      default_skipped: "cancelled",
    };
    extension.occurrences = {
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
    await this.ensureViewConfiguration(resources.paths.config);
    this.typesFolder = await this.readTypesFolder(resources.paths.config);
    const existingTypes = await this.listTypeFiles(this.typesFolder);
    if (!existingTypes.length)
      await this.vault.ensureText(
        `${this.typesFolder}/task.md`,
        serializeMarkdownDocument(generatedType, generated.body),
      );
    await this.refreshConfiguration();
  }

  async refreshConfiguration(): Promise<boolean> {
    const nextTypesFolder = await this.readTypesFolder("mdbase.yaml");
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
          const extension = parsed.frontmatter["x-tasknotes"];
          const contract =
            extension &&
            typeof extension === "object" &&
            !Array.isArray(extension)
              ? (extension as Record<string, unknown>).contract
              : undefined;
          return contract === "tasknotes.task"
            ? [{ entry, source, parsed }]
            : [];
        }),
      )
    ).flat();
    if (!matches.length)
      throw new Error(
        `No type providing x-tasknotes.contract: tasknotes.task was found in ${nextTypesFolder}/.`,
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
    const current = await this.readViewSource(path);
    if (ifRevision && ifRevision !== current.revision)
      throw new Error(
        "This view changed after it was opened. Reload it before deleting.",
      );
    await this.vault.delete(path);
  }

  async read(document: VaultEntry): Promise<Task | null> {
    try {
      const parsed = parseFrontmatter(await this.vault.readText(document.path));
      return this.taskModel.read({
        path: document.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      });
    } catch {
      return null;
    }
  }

  private async readCollectionRecord(
    document: VaultEntry,
  ): Promise<CollectionRecord | null> {
    try {
      const parsed = parseFrontmatter(await this.vault.readText(document.path));
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

  createTask(input: CreateTaskInput, id: string, now: string): Promise<Task> {
    return this.taskModel.createWithTemplate(input, { id, now }, (path) =>
      this.vault.readText(path),
    );
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

  materializeOccurrence(
    parent: Task,
    targetDate: string,
    existingOccurrences: readonly Task[],
    id: string,
    now: string,
  ): Promise<MaterializeOccurrenceResult> {
    return this.taskModel.materializeOccurrence(
      parent,
      targetDate,
      existingOccurrences,
      { id, now },
      (path) => this.vault.readText(path),
    );
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

  async write(task: Task): Promise<VaultEntry> {
    const source = await this.vault.writeText(
      task.path,
      serializeMarkdownDocument(task.frontmatter, task.body),
    );
    this.collectionRecordCache.set(task.path, {
      lastModified: source.lastModified,
      size: source.size,
      record: taskCollectionRecord(task),
    });
    return source;
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
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
    await this.vault.delete(path);
    this.collectionRecordCache.delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.vault.exists(path);
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

  private async readTypesFolder(configPath: string): Promise<string> {
    const source = await this.vault.readText(configPath);
    const document = parseDocument(source);
    if (document.errors.length) throw new Error(document.errors[0].message);
    const value = document.toJS() as {
      settings?: { types_folder?: unknown; typesFolder?: unknown };
    } | null;
    const configured =
      value?.settings?.types_folder ?? value?.settings?.typesFolder;
    if (typeof configured !== "string" || !configured.trim()) return "_types";
    return normalizeResourceFolder(configured);
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
    return (
      normalized.startsWith(typeRoot) ||
      normalized.includes(`/${typeRoot}`) ||
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
