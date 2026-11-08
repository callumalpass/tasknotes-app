import type { Task } from "../domain/task";
import type {
  TaskImportPort,
  TaskImportTarget,
  ImportedRecord,
} from "./ports/task-import";
import type { CollectionFileStore } from "./ports/collection-file-store";
import type {
  CollectionSnapshot,
  TransferLedger,
} from "./ports/local-collection";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import { SCRATCHPAD_TYPE } from "../domain/scratchpad";
import { SCRATCH_IMAGE_TYPE } from "../domain/scratch-image";

export interface TaskTransferPlan {
  target: TaskImportTarget;
  statuses: Record<string, string>;
  priorities: Record<string, string>;
  customValues: Record<string, unknown>;
}
export function suggestTransferPlan(
  source: CollectionSnapshot,
  target: TaskImportTarget,
): TaskTransferPlan {
  const configuration = resolveTaskCollectionConfiguration(
    source.modelDefinition,
    source.settingsRecord ? { settings: source.settingsRecord } : {},
  );
  const statuses: Record<string, string> = {};
  const priorities: Record<string, string> = {};
  for (const value of new Set(source.tasks.map((task) => task.status))) {
    const original = configuration.statuses.find(
      (status) => status.value === value,
    );
    const candidates = target.configuration.statuses.filter(
      (status) =>
        !!status.isCompleted === !!original?.isCompleted &&
        !!status.isSkipped === !!original?.isSkipped,
    );
    const exact = candidates.find((status) => status.value === value);
    if (exact || candidates.length === 1)
      statuses[value] = (exact ?? candidates[0]!).value;
  }
  for (const value of new Set(source.tasks.map((task) => task.priority))) {
    const exact = target.configuration.priorities.find(
      (priority) => priority.value === value,
    );
    if (exact) priorities[value] = exact.value;
  }
  return { target, statuses, priorities, customValues: {} };
}

/** Completed transfers retain provenance. Only new or changed local content
 * needs review. Importing a changed item creates a separate destination copy. */
export function pendingTransferSource(
  source: CollectionSnapshot,
  history: readonly TransferLedger[],
): CollectionSnapshot {
  const completed = history
    .filter((ledger) => ledger.completed && ledger.source.id === source.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const records = new Map<string, string>();
  const files = new Map<string, string | undefined>();
  for (const ledger of completed) {
    const keys = new Set(ledger.prepared.map((record) => record.key));
    for (const task of ledger.source.tasks)
      if (keys.has(task.id)) records.set(task.id, taskContent(task));
    for (const note of ledger.source.scratchpads)
      if (keys.has(`note:${note.id}`))
        records.set(`note:${note.id}`, noteContent(note));
    for (const image of ledger.source.scratchImages)
      if (keys.has(`image:${image.id}`))
        records.set(`image:${image.id}`, imageContent(image));
    for (const entry of ledger.source.files)
      files.set(entry.file.path, entry.file.contentDigest);
  }
  return {
    ...source,
    tasks: source.tasks.filter(
      (task) => records.get(task.id) !== taskContent(task),
    ),
    scratchpads: source.scratchpads.filter(
      (note) => records.get(`note:${note.id}`) !== noteContent(note),
    ),
    scratchImages: source.scratchImages.filter(
      (image) => records.get(`image:${image.id}`) !== imageContent(image),
    ),
    files: source.files.filter(
      (entry) =>
        !files.has(entry.file.path) ||
        files.get(entry.file.path) !== entry.file.contentDigest,
    ),
  };
}

export function hasTransferWork(source: CollectionSnapshot): boolean {
  return Boolean(
    source.tasks.length ||
    source.files.length ||
    source.scratchImages.length ||
    source.scratchpads.some((note) => note.body.trim() || note.title?.trim()),
  );
}

function taskContent(task: Task): string {
  return contentKey({
    ...task,
    // Save bookkeeping and derived frontmatter do not constitute a content edit.
    revision: undefined,
    updatedAt: undefined,
    operationWarnings: undefined,
    frontmatter: undefined,
  });
}

function noteContent(note: CollectionSnapshot["scratchpads"][number]): string {
  // Moving a note into history or resuming it leaves its imported content intact.
  return contentKey({
    id: note.id,
    path: note.path,
    title: note.title ?? "",
    body: note.body,
  });
}

function imageContent(
  image: CollectionSnapshot["scratchImages"][number],
): string {
  return contentKey({ ...image, revision: undefined, dateModified: undefined });
}

function contentKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Produces the full immutable payload before writing anything to the destination.
 * The caller stores this ledger durably before invoking executeTransfer. */
export async function prepareTransfer(
  source: CollectionSnapshot,
  destination: string,
  plan: TaskTransferPlan,
  port: TaskImportPort,
  history: readonly TransferLedger[] = [],
): Promise<TransferLedger> {
  const records: TransferLedger["records"] = {};
  const prepared: ImportedRecord[] = [];
  const files: TransferLedger["files"] = {};
  const runId = crypto.randomUUID();
  const key = JSON.stringify([source.id, destination, runId]);
  for (const entry of source.files)
    files[entry.file.path] = {
      path: `TaskNotes/Imports/${runId}/${entry.file.path}`,
    };
  const ids = new Map(
    source.tasks.map((task) => [task.id, crypto.randomUUID()]),
  );
  const links = new Map<string, string>();
  const referenceLinks = new Map<string, string>();
  for (const previous of history.filter((entry) => entry.completed)) {
    for (const record of previous.prepared) {
      const original =
        previous.source.tasks.find((task) => task.id === record.key) ??
        previous.source.scratchpads.find(
          (note) => `note:${note.id}` === record.key,
        );
      if (original) {
        links.set(original.id, record.id);
        referenceLinks.set(original.id, record.path);
        links.set(original.path, record.path);
        links.set(
          original.path.replace(/\.md$/u, ""),
          record.path.replace(/\.md$/u, ""),
        );
      }
    }
    for (const [path, file] of Object.entries(previous.files))
      links.set(path, file.path);
  }
  for (const [from, to] of [
    ...ids,
    ...Object.entries(files).map(
      ([from, file]) => [from, file.path] as [string, string],
    ),
  ] as [string, string][])
    links.set(from, to);
  for (const task of source.tasks) {
    const status = plan.statuses[task.status];
    const priority = plan.priorities[task.priority];
    if (!status || !priority) throw new Error("import_mapping_required");
    const destinationStatus = plan.target.configuration.statuses.find(
      (candidate) => candidate.value === status,
    );
    const original = resolveTaskCollectionConfiguration(
      source.modelDefinition,
      source.settingsRecord ? { settings: source.settingsRecord } : {},
    ).statuses.find((candidate) => candidate.value === task.status);
    if (
      !destinationStatus ||
      !!destinationStatus.isCompleted !== !!original?.isCompleted ||
      !!destinationStatus.isSkipped !== !!original?.isSkipped
    )
      throw new Error("import_status_semantics_changed");
    const mapped: Task = {
      ...structuredClone(task),
      status,
      priority,
      customProperties: { ...task.customProperties, ...plan.customValues },
    };
    const record = await port.prepareTask(
      mapped,
      plan.target,
      ids.get(task.id)!,
    );
    // Reserve paths between records in this batch too; creates never replace an existing record.
    if (prepared.some((other) => other.path === record.path))
      record.path = record.path.replace(/\.md$/u, `-${record.id}.md`);
    referenceLinks.set(task.id, record.path);
    links.set(task.path, record.path);
    links.set(
      task.path.replace(/\.md$/u, ""),
      record.path.replace(/\.md$/u, ""),
    );
    prepared.push(record);
  }
  for (const note of source.scratchpads.filter(
    (note) => note.body.trim() || note.title?.trim(),
  )) {
    const id = crypto.randomUUID();
    const path = `TaskNotes/Scratchpad/Imported/${runId}/${id}.md`;
    links.set(note.id, id);
    referenceLinks.set(note.id, path);
    links.set(note.path, path);
    prepared.push({
      key: `note:${note.id}`,
      id,
      type: SCRATCHPAD_TYPE,
      path,
      frontmatter: {
        type: SCRATCHPAD_TYPE,
        id,
        state: "converted",
        dateCreated: note.dateCreated,
        dateModified: note.dateModified,
        dateConverted: note.dateConverted ?? note.dateModified,
        ...(note.title ? { title: note.title } : {}),
      },
      body: note.body,
    });
  }
  for (const image of source.scratchImages) {
    const id = crypto.randomUUID();
    prepared.push({
      key: `image:${image.id}`,
      id,
      type: SCRATCH_IMAGE_TYPE,
      path: `TaskNotes/Scratchpad/Image Metadata/${id}.md`,
      body: "",
      frontmatter: {
        ...image,
        type: SCRATCH_IMAGE_TYPE,
        id,
        kind: undefined,
        path: undefined,
        revision: undefined,
      },
    });
  }
  for (const [from, to] of links)
    if (!referenceLinks.has(from)) referenceLinks.set(from, to);
  // Short wikilinks are portable only when the source name is unambiguous.
  const aliases = new Map<string, string | null>();
  for (const [from, to] of referenceLinks) {
    if (!from.includes("/")) continue;
    const alias = from.slice(from.lastIndexOf("/") + 1);
    aliases.set(
      alias,
      !aliases.has(alias) || aliases.get(alias) === to ? to : null,
    );
  }
  for (const [alias, to] of aliases)
    if (to && !referenceLinks.has(alias)) referenceLinks.set(alias, to);
  const sourcePaths = new Map([
    ...source.tasks.map((task) => [task.id, task.path] as const),
    ...source.scratchpads.map(
      (note) => [`note:${note.id}`, note.path] as const,
    ),
  ]);
  for (const record of prepared) {
    const sourcePath = sourcePaths.get(record.key);
    record.frontmatter = rewriteValues(
      record.frontmatter,
      links,
      referenceLinks,
      sourcePath,
    ) as Record<string, unknown>;
    // Undefined is not a portable mdbase value.
    record.frontmatter = JSON.parse(JSON.stringify(record.frontmatter));
    record.body = rewriteText(record.body, referenceLinks, sourcePath);
    records[record.key] = { id: record.id, mutationId: crypto.randomUUID() };
  }
  return {
    key,
    destination,
    createdAt: Date.now(),
    source,
    plan,
    records,
    files,
    prepared,
  };
}

function rewriteValues(
  value: unknown,
  links: Map<string, string>,
  referenceLinks: Map<string, string>,
  sourcePath?: string,
): unknown {
  if (typeof value === "string")
    return links.get(value) ?? rewriteText(value, referenceLinks, sourcePath);
  if (Array.isArray(value))
    return value.map((item) =>
      rewriteValues(item, links, referenceLinks, sourcePath),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteValues(item, links, referenceLinks, sourcePath),
      ]),
    );
  return value;
}
function rewriteText(
  text: string,
  links: Map<string, string>,
  sourcePath?: string,
): string {
  const destination = (target: string) => {
    const split = target.search(/[?#]/u);
    const path = split < 0 ? target : target.slice(0, split);
    const suffix = split < 0 ? "" : target.slice(split);
    let decoded = path.replace(/^\.\//u, "");
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* A literal percent is a legal filename. */
    }
    let relativePath: string | undefined;
    if (sourcePath && /^\.\.?\//u.test(path)) {
      const parts = sourcePath.split("/").slice(0, -1);
      for (const part of decoded.split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      relativePath = parts.join("/");
    }
    const mapped =
      (relativePath ? links.get(relativePath) : undefined) ??
      links.get(path) ??
      links.get(decoded);
    return mapped === undefined ? undefined : { mapped, suffix };
  };
  return text
    .replace(
      /\[\[([^\]|]+)([^\]]*)\]\]/gu,
      (whole, path: string, alias: string) => {
        const found = destination(path);
        return found ? `[[${found.mapped}${found.suffix}${alias}]]` : whole;
      },
    )
    .replace(
      /(!?\[[^\]]*\]\()(<[^>]+>|[^\s)]+)(\))/gu,
      (whole, lead: string, path: string, end: string) => {
        const angled = path.startsWith("<") && path.endsWith(">");
        const found = destination(angled ? path.slice(1, -1) : path);
        return found
          ? `${lead}${angled ? `<${found.mapped}${found.suffix}>` : `${encodeURI(found.mapped)}${found.suffix}`}${end}`
          : whole;
      },
    );
}

export async function executeTransfer(
  ledger: TransferLedger,
  port: TaskImportPort,
  destinationFiles: CollectionFileStore | undefined,
  save: (ledger: TransferLedger) => Promise<void>,
  progress: () => void = () => {},
): Promise<void> {
  for (const entry of ledger.source.files) {
    const state = ledger.files[entry.file.path]!;
    if (state.confirmed) continue;
    if (!destinationFiles) throw new Error("import_file_access_required");
    const existing = (
      await destinationFiles.list({
        folder: state.path.slice(0, state.path.lastIndexOf("/")),
      })
    ).find((file) => file.path === state.path);
    if (existing) {
      if (existing.contentDigest !== entry.file.contentDigest)
        throw new Error("import_file_collision");
    } else {
      if (state.attempted) throw new Error("import_file_outcome_unknown");
      state.attempted = true;
      await save(ledger);
      const uploaded = await destinationFiles.upload(state.path, entry.bytes, {
        mediaType: entry.file.mediaType,
      });
      if (uploaded.contentDigest !== entry.file.contentDigest)
        throw new Error("import_file_digest_mismatch");
    }
    state.confirmed = true;
    await save(ledger);
    progress();
  }
  for (const record of ledger.prepared) {
    const state = ledger.records[record.key]!;
    if (state.confirmed) continue;
    const recovering = !!state.attempted;
    state.attempted = true;
    await save(ledger);
    await port.write(record, state.mutationId, recovering);
    state.confirmed = true;
    await save(ledger);
    progress();
  }
  ledger.completed = true;
  await save(ledger);
  progress();
}
