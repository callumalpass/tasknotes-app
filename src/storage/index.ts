import Dexie, { type EntityTable } from "dexie";

import type { Task } from "../domain/task";

export interface IndexedTask extends Task {
  sourceMtime: number;
  sourceSize: number;
  searchText: string;
}

export class TaskIndex extends Dexie {
  tasks!: EntityTable<IndexedTask, "id">;

  constructor(name = "tasknotes-index-v2") {
    super(name);
    this.version(1).stores({
      tasks:
        "&id,&path,completed,status,scheduled,due,priority,updatedAt,sourceMtime",
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
