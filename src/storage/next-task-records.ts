import type { RecordView } from "@mdbase-dev/sdk";
import type { Task, TaskSummary } from "../domain/task";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";

export type NextTaskModels = ReadonlyMap<string, TaskNotesTaskModel>;

function modelFor(
  record: RecordView,
  models: NextTaskModels,
): TaskNotesTaskModel | null {
  const matches = record.types.flatMap((type) => {
    const model = models.get(type);
    return model ? [model] : [];
  });
  if (matches.length > 1)
    throw new Error(
      "The record has more than one TaskNotes task implementation.",
    );
  return matches[0] ?? null;
}

/** App/domain projection only: all type classification, query and link semantics
 * belong to the replica. Models come from its verified TaskNotes contract.
 * These functions are dormant until the native next repository is wired in.
 */
export function nextTaskSummary(
  record: RecordView,
  models: NextTaskModels,
): TaskSummary | null {
  const model = modelFor(record, models);
  if (!model) return null;
  const task = model.readSummary({
    path: record.path,
    frontmatter: record.effective ?? record.frontmatter,
  });
  task.recordVersion = JSON.stringify([record.id, record.revision]);
  return task;
}

export function nextTaskDocument(
  record: RecordView,
  models: NextTaskModels,
): Task | null {
  const model = modelFor(record, models);
  if (!model) return null;
  if (record.body === undefined)
    throw new Error("Mdbase did not return the complete task body.");
  const task = model.read({
    path: record.path,
    frontmatter: record.effective ?? record.frontmatter,
    body: record.body,
  });
  task.recordVersion = JSON.stringify([record.id, record.revision]);
  return task;
}
