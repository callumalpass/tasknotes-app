import { toPlain, type wire } from "@mdbase-dev/sdk";
import type { Task, TaskSummary } from "../domain/task";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";

export type NextTaskModels = ReadonlyMap<string, TaskNotesTaskModel>;

function modelFor(
  record: wire.RecordView,
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

function frontmatter(record: wire.RecordView): Record<string, unknown> {
  return Object.fromEntries(
    [...(record.effective ?? record.frontmatter)].map(([key, value]) => [
      key,
      toPlain(value),
    ]),
  );
}

/** App/domain projection only: all type classification, query and link semantics
 * belong to the replica. Models come from its verified TaskNotes contract.
 * These functions are dormant until the native next repository is wired in.
 */
export function nextTaskSummary(
  record: wire.RecordView,
  models: NextTaskModels,
): TaskSummary | null {
  const model = modelFor(record, models);
  if (!model) return null;
  return {
    ...model.readSummary({
      path: record.path,
      frontmatter: frontmatter(record),
    }),
    // Replica identity is independent of an optional portable TaskNotes ID.
    id: record.id,
  };
}

export function nextTaskDocument(
  record: wire.RecordView,
  models: NextTaskModels,
): Task | null {
  const model = modelFor(record, models);
  if (!model) return null;
  if (record.body === undefined)
    throw new Error("Mdbase did not return the complete task body.");
  return {
    ...model.read({
      path: record.path,
      frontmatter: frontmatter(record),
      body: record.body,
    }),
    id: record.id,
  };
}
