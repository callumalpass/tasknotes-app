import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskViewRow, TaskViewExecution } from "../domain/view";
import {
  sortTasksByManualOrder,
  type ManualOrderConfiguration,
} from "../domain/manual-order";

export function executionWithoutTask(
  execution: TaskViewExecution,
  taskId: string,
): TaskViewExecution {
  const removedPath = execution.rows.find((row) => row.task.id === taskId)?.task
    .path;
  const rows = execution.rows.filter((row) => row.task.id !== taskId);
  if (rows.length === execution.rows.length) return execution;
  return {
    ...execution,
    rows,
    records: removedPath
      ? execution.records?.filter(({ record }) => record.path !== removedPath)
      : execution.records,
    totalCount: Math.max(0, execution.totalCount - 1),
  };
}

export function executionWithManualRanks(
  execution: TaskViewExecution,
  ranks: ReadonlyMap<string, OptimisticManualRank>,
  viewKey: string,
  order: ManualOrderConfiguration,
  sortOrderField: string,
): TaskViewExecution {
  const rows = execution.rows.map((row) => {
    const rank = ranks.get(row.task.id);
    if (!rank || rank.viewKey !== viewKey) return row;
    return {
      ...row,
      task: {
        ...row.task,
        sortOrder: rank.sortOrder,
        frontmatter: {
          ...row.task.frontmatter,
          [sortOrderField]: rank.sortOrder,
        },
      },
    };
  });
  const rowByTask = new Map(rows.map((row) => [row.task.id, row]));
  return {
    ...execution,
    view: {
      ...execution.view,
      sort: execution.view.sort?.length ? execution.view.sort : [order],
    },
    rows: sortTasksByManualOrder(
      rows.map(({ task }) => task),
      order.direction,
    ).map((task) => rowByTask.get(task.id)!),
  };
}

export interface TaskListLane {
  key: string;
  label?: string;
  className?: string;
  rows: TaskViewRow[];
  mutation?:
    | { type: "group"; values: Record<string, unknown> }
    | { type: "section"; mode: unknown; section: string };
}

export function applyOptimisticListMoves(
  lanes: readonly TaskListLane[],
  rows: readonly TaskViewRow[],
  moves: ReadonlyMap<string, { laneKey: string }>,
  manualOrder: ManualOrderConfiguration | null,
): TaskListLane[] {
  if (!moves.size) return lanes.map((lane) => ({ ...lane }));
  const rowById = new Map(rows.map((row) => [row.task.id, row]));
  const movedIds = new Set(moves.keys());
  return lanes.map((lane) => {
    const movedHere = [...moves]
      .filter(([, move]) => move.laneKey === lane.key)
      .flatMap(([taskId]) => {
        const row = rowById.get(taskId);
        return row ? [row] : [];
      });
    const nextRows = [
      ...lane.rows.filter((row) => !movedIds.has(row.task.id)),
      ...movedHere,
    ];
    if (!manualOrder) return { ...lane, rows: nextRows };
    const byId = new Map(nextRows.map((row) => [row.task.id, row]));
    return {
      ...lane,
      rows: sortTasksByManualOrder(
        nextRows.map((row) => row.task),
        manualOrder.direction,
      ).map((task) => byId.get(task.id)!),
    };
  });
}

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
