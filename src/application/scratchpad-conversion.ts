import {
  TaskRevisionChangedError,
  type TaskRepository,
} from "./ports/task-repository";
import type { ScratchNode } from "../domain/scratchpad";
import type { TaskSummary } from "../domain/task";

export interface ScratchpadConversion {
  draft: ScratchNode;
  linked: ScratchNode;
  task: TaskSummary;
  children: { before: TaskSummary; after: TaskSummary }[];
}

export async function undoScratchpadConversion(
  repository: TaskRepository,
  conversion: ScratchpadConversion,
  currentNodes: () => readonly ScratchNode[],
): Promise<"restored" | "changed"> {
  const { task, draft, linked, children } = conversion;
  const sourceUnchanged = () => {
    const current = currentNodes().find(({ id }) => id === draft.id);
    return (
      current &&
      current.kind === "task" &&
      current.link === linked.link &&
      current.text === linked.text &&
      current.depth === linked.depth
    );
  };
  if (!sourceUnchanged()) return "changed";
  const current = await repository.get(task.id);
  if (!current || current.revision !== task.revision) return "changed";
  for (const child of children) {
    const latest = await repository.get(child.after.id);
    if (!latest || latest.revision !== child.after.revision) return "changed";
  }
  if (!sourceUnchanged()) return "changed";
  try {
    for (const child of children)
      await repository.update(
        child.after.id,
        { projects: child.before.projects },
        { expectedRevision: child.after.revision },
      );
    await repository.delete(task.id, { expectedRevision: task.revision });
  } catch (reason) {
    if (reason instanceof TaskRevisionChangedError) return "changed";
    throw reason;
  }
  return "restored";
}
