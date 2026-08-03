import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskViewRow } from "../domain/view";

export interface OptimisticBoardMove {
  viewKey: string;
  property: string;
  value: unknown;
  sequence: number;
}

export interface OptimisticListMove {
  viewKey: string;
  laneKey: string;
  input: UpdateTaskInput;
  sequence: number;
}

export interface OptimisticManualRank {
  viewKey: string;
  sortOrder: string;
  operationId: number;
}

export function removeConfirmedManualRanks(
  ranks: Map<string, OptimisticManualRank>,
  rows: ReadonlyMap<string, TaskViewRow>,
  viewKey: string,
  sortOrderField: string,
): Map<string, OptimisticManualRank> {
  let next: Map<string, OptimisticManualRank> | null = null;
  for (const [taskId, rank] of ranks) {
    if (rank.viewKey !== viewKey) continue;
    const row = rows.get(taskId);
    const authoritative =
      row?.task.sortOrder ?? row?.task.frontmatter[sortOrderField];
    if (row && authoritative !== rank.sortOrder) continue;
    next ??= new Map(ranks);
    next.delete(taskId);
  }
  return next ?? ranks;
}

export function removeConfirmedBoardMoves(
  moves: Map<string, OptimisticBoardMove>,
  rows: ReadonlyMap<string, TaskViewRow>,
  viewKey: string,
): Map<string, OptimisticBoardMove> {
  let next: Map<string, OptimisticBoardMove> | null = null;
  for (const [taskId, move] of moves) {
    if (move.viewKey !== viewKey) continue;
    const row = rows.get(taskId);
    const authoritative = row
      ? (row.values[move.property] ??
        row.task.frontmatter[move.property] ??
        null)
      : undefined;
    if (row && valueKey(authoritative) !== valueKey(move.value)) continue;
    next ??= new Map(moves);
    next.delete(taskId);
  }
  return next ?? moves;
}

export function removeConfirmedListMoves(
  moves: Map<string, OptimisticListMove>,
  rows: ReadonlyMap<string, TaskViewRow>,
  viewKey: string,
): Map<string, OptimisticListMove> {
  let next: Map<string, OptimisticListMove> | null = null;
  for (const [taskId, move] of moves) {
    if (move.viewKey !== viewKey) continue;
    const row = rows.get(taskId);
    if (row && !taskReflectsUpdate(row.task, move.input)) continue;
    next ??= new Map(moves);
    next.delete(taskId);
  }
  return next ?? moves;
}

function taskReflectsUpdate(task: Task, input: UpdateTaskInput): boolean {
  return (
    Object.entries(input) as Array<[keyof UpdateTaskInput, unknown]>
  ).every(([property, expected]) => {
    const current = task[property as keyof Task];
    return expected === null
      ? current === null || current === undefined
      : valueKey(current) === valueKey(expected);
  });
}

function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}
