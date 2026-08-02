import type { Task } from "./task";
import type { TaskViewSort } from "./view";

export type ManualOrderDirection = "asc" | "desc";
export type ManualOrderPlacement = "before" | "after";

export interface ManualOrderConfiguration {
  property: string;
  direction: ManualOrderDirection;
}

export interface ManualOrderWrite {
  taskId: string;
  sortOrder: string;
}

export interface ManualOrderPlan {
  order: string[];
  writes: ManualOrderWrite[];
  reason: "midpoint" | "boundary" | "rebalance" | "unchanged";
}

const PREFIX = "tn";
const WIDTH = 10;
const BASE = 26;
const MAX = BASE ** WIDTH - 1;
const PATTERN = /^tn[a-z]{10}$/;

export function manualOrderConfiguration(
  sort: readonly TaskViewSort[] | undefined,
  sortOrderField: string,
): ManualOrderConfiguration | null {
  const first = sort?.[0];
  if (!first || !isManualOrderProperty(first.property, sortOrderField))
    return null;
  return {
    property: first.property,
    direction: first.direction === "desc" ? "desc" : "asc",
  };
}

export function isManualOrderProperty(
  property: string,
  sortOrderField: string,
): boolean {
  return propertyName(property) === sortOrderField;
}

export function enableManualOrderSort(
  sort: readonly TaskViewSort[] | undefined,
  sortOrderField: string,
  defaultProperty: string,
): TaskViewSort[] {
  const existing = sort?.find(({ property }) =>
    isManualOrderProperty(property, sortOrderField),
  );
  return [
    existing ?? { property: defaultProperty, direction: "desc" },
    ...(sort ?? []).filter(
      ({ property }) => !isManualOrderProperty(property, sortOrderField),
    ),
  ];
}

export function disableManualOrderSort(
  sort: readonly TaskViewSort[] | undefined,
  sortOrderField: string,
): TaskViewSort[] {
  return (sort ?? []).filter(
    ({ property }) => !isManualOrderProperty(property, sortOrderField),
  );
}

export function planManualOrder(
  tasks: readonly Task[],
  dragged: Task,
  targetId: string | undefined,
  placement: ManualOrderPlacement,
  direction: ManualOrderDirection,
): ManualOrderPlan {
  const current = tasks.map(({ id }) => id);
  const ordered = tasks.filter(({ id }) => id !== dragged.id);
  const targetIndex = targetId
    ? ordered.findIndex(({ id }) => id === targetId)
    : -1;
  const insertAt =
    targetIndex < 0
      ? ordered.length
      : targetIndex + (placement === "after" ? 1 : 0);
  ordered.splice(insertAt, 0, dragged);
  const order = ordered.map(({ id }) => id);
  if (sameOrder(current, order))
    return { order, writes: [], reason: "unchanged" };

  const withoutDragged = ordered.filter(({ id }) => id !== dragged.id);
  if (hasOrderedAlphaRanks(withoutDragged, direction)) {
    const previous = ordered[insertAt - 1];
    const next = ordered[insertAt + 1];
    const rank = rankBetween(
      previous ? decode(previous.sortOrder)! : boundaryBefore(direction),
      next ? decode(next.sortOrder)! : boundaryAfter(direction),
      direction,
    );
    if (rank !== null) {
      const sortOrder = encode(rank);
      return {
        order,
        writes:
          dragged.sortOrder === sortOrder
            ? []
            : [{ taskId: dragged.id, sortOrder }],
        reason: previous && next ? "midpoint" : "boundary",
      };
    }
  }

  return {
    order,
    writes: ordered.flatMap((task, index) => {
      const sortOrder = rankForIndex(index, ordered.length, direction);
      return task.sortOrder === sortOrder
        ? []
        : [{ taskId: task.id, sortOrder }];
    }),
    reason: "rebalance",
  };
}

export function appendManualOrderRank(
  tasks: readonly Task[],
  direction: ManualOrderDirection,
): string | undefined {
  if (!tasks.length) return encode(Math.floor(MAX / 2));
  if (!hasOrderedAlphaRanks(tasks, direction)) return undefined;
  const last = decode(tasks.at(-1)?.sortOrder);
  if (last === null) return undefined;
  const boundary = boundaryAfter(direction);
  const rank = rankBetween(last, boundary, direction);
  return rank === null ? undefined : encode(rank);
}

export function sortTasksByManualOrder(
  tasks: readonly Task[],
  direction: ManualOrderDirection,
): Task[] {
  const original = new Map(tasks.map((task, index) => [task.id, index]));
  return [...tasks].sort((left, right) => {
    const compared = compareRankValues(left.sortOrder, right.sortOrder);
    if (compared) return direction === "desc" ? -compared : compared;
    return (original.get(left.id) ?? 0) - (original.get(right.id) ?? 0);
  });
}

export function isTaskNotesSortRank(value?: string): boolean {
  return decode(value) !== null;
}

function propertyName(value: string): string {
  const bracket = /^(?:note|file|task)\[["'](.+)["']\]$/.exec(value);
  if (bracket) return bracket[1];
  return value.replace(/^(?:note|file|task)\./, "");
}

function hasOrderedAlphaRanks(
  tasks: readonly Task[],
  direction: ManualOrderDirection,
): boolean {
  let previous: number | null = null;
  const seen = new Set<number>();
  for (const task of tasks) {
    const rank = decode(task.sortOrder);
    if (
      rank === null ||
      seen.has(rank) ||
      (previous !== null &&
        (direction === "asc" ? previous >= rank : previous <= rank))
    )
      return false;
    seen.add(rank);
    previous = rank;
  }
  return true;
}

function rankBetween(
  previous: number,
  next: number,
  direction: ManualOrderDirection,
): number | null {
  const upper = Math.max(previous, next);
  const lower = Math.min(previous, next);
  const midpoint = Math.floor((upper + lower) / 2);
  if (midpoint <= lower || midpoint >= upper) return null;
  if (
    direction === "asc"
      ? !(previous < midpoint && midpoint < next)
      : !(previous > midpoint && midpoint > next)
  )
    return null;
  return midpoint;
}

function boundaryBefore(direction: ManualOrderDirection): number {
  return direction === "asc" ? 0 : MAX;
}

function boundaryAfter(direction: ManualOrderDirection): number {
  return direction === "asc" ? MAX : 0;
}

function rankForIndex(
  index: number,
  total: number,
  direction: ManualOrderDirection,
): string {
  const step = Math.max(1, Math.floor(MAX / (total + 1)));
  const ordinal = direction === "asc" ? index + 1 : total - index;
  return encode(step * ordinal);
}

function encode(value: number): string {
  let remaining = Math.max(0, Math.min(MAX, Math.floor(value)));
  const characters = Array<string>(WIDTH);
  for (let index = WIDTH - 1; index >= 0; index -= 1) {
    characters[index] = String.fromCharCode(97 + (remaining % BASE));
    remaining = Math.floor(remaining / BASE);
  }
  return `${PREFIX}${characters.join("")}`;
}

function decode(value?: string): number | null {
  if (!value || !PATTERN.test(value)) return null;
  let result = 0;
  for (const character of value.slice(PREFIX.length))
    result = result * BASE + character.charCodeAt(0) - 97;
  return result;
}

function compareRankValues(left?: string, right?: string): number {
  if (left && right) {
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });
    const compared = collator.compare(left, right);
    return compared || left.localeCompare(right);
  }
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
