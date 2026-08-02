import Dexie, { type EntityTable } from "dexie";

import type { Task } from "../domain/task";
import type { PendingLocalMutation } from "./mutation-outbox";

export interface IndexedTask extends Task {
  sourceMtime: number;
  sourceSize: number;
  searchText: string;
}

export interface IndexMetadata {
  key: "projection";
  complete: boolean;
  consistencyVersion?: number;
  taskShapeVersion?: number;
  needsReindex?: boolean;
}

export class TaskIndex extends Dexie {
  tasks!: EntityTable<IndexedTask, "id">;
  metadata!: EntityTable<IndexMetadata, "key">;
  mutations!: EntityTable<PendingLocalMutation, "taskId">;

  constructor(name = "tasknotes-index-v2") {
    super(name);
    this.version(1).stores({
      tasks:
        "&id,&path,completed,status,scheduled,due,priority,updatedAt,sourceMtime",
    });
    this.version(2).stores({
      tasks: "&id",
    });
    this.version(3).stores({
      tasks: "&id",
      metadata: "&key",
    });
    this.version(4).stores({
      tasks: "&id",
      metadata: "&key",
      mutations: "&taskId,enqueuedAt",
    });
  }
}

export function indexTask(
  task: Task,
  source: { lastModified: number; size: number },
): IndexedTask {
  return {
    ...task,
    sourceMtime: source.lastModified,
    sourceSize: source.size,
    searchText: [
      task.title,
      task.body,
      ...task.tags,
      ...task.contexts,
      ...task.projects,
      ...task.attachments,
    ]
      .join("\n")
      .toLocaleLowerCase(),
  };
}

export function withoutIndexFields(task: IndexedTask): Task {
  const plain: Partial<IndexedTask> = { ...task };
  delete plain.sourceMtime;
  delete plain.sourceSize;
  delete plain.searchText;
  return plain as Task;
}

export function indexedTaskNeedsNormalization(task: IndexedTask): boolean {
  return (
    !Array.isArray(task.tags) ||
    !Array.isArray(task.contexts) ||
    !Array.isArray(task.projects) ||
    !Array.isArray(task.attachments) ||
    !Array.isArray(task.blockedBy) ||
    !Array.isArray(task.completeInstances) ||
    !Array.isArray(task.skippedInstances) ||
    !Array.isArray(task.reminders) ||
    !Array.isArray(task.timeEntries) ||
    !isRecord(task.customProperties) ||
    !isRecord(task.frontmatter) ||
    typeof task.searchText !== "string"
  );
}

export function normalizeIndexedTask(task: IndexedTask): IndexedTask {
  if (!indexedTaskNeedsNormalization(task)) return task;
  const normalized: Task = {
    ...task,
    tags: stringArray(task.tags),
    contexts: stringArray(task.contexts),
    projects: stringArray(task.projects),
    attachments: stringArray(task.attachments),
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy : [],
    completeInstances: stringArray(task.completeInstances),
    skippedInstances: stringArray(task.skippedInstances),
    reminders: Array.isArray(task.reminders) ? task.reminders : [],
    timeEntries: Array.isArray(task.timeEntries) ? task.timeEntries : [],
    customProperties: isRecord(task.customProperties)
      ? task.customProperties
      : {},
    frontmatter: isRecord(task.frontmatter) ? task.frontmatter : {},
  };
  return indexTask(normalized, {
    lastModified: Number.isFinite(task.sourceMtime) ? task.sourceMtime : 0,
    size: Number.isFinite(task.sourceSize) ? task.sourceSize : 0,
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
