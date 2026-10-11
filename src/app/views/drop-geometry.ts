import type { ManualOrderPlacement } from "../../domain/manual-order";

/**
 * Where rows and lanes sat when a drag began, in the content coordinates of
 * the list or board. Rows part to preview the drop while the pointer moves,
 * so hit testing against the live DOM would chase rows that slide away under
 * the pointer; positions are resolved against this snapshot instead.
 */
export interface DropLayout {
  lanes: DropLane[];
}

export interface DropLane {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  rows: Array<{ id: string; top: number; bottom: number }>;
}

export interface DropPosition {
  laneKey: string;
  targetId?: string;
  placement: ManualOrderPlacement;
}

export interface DropPoint {
  x: number;
  y: number;
}

/** Content coordinates of `root`, so page or board scrolling is not a move. */
export function contentPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): DropPoint {
  const origin = root.getBoundingClientRect();
  return {
    x: clientX - origin.left + root.scrollLeft,
    y: clientY - origin.top + root.scrollTop,
  };
}

export function measureDropLayout(
  root: HTMLElement,
  lanes: readonly { key: string; element: HTMLElement }[],
  rowSelector: string,
  rowId: (row: HTMLElement) => string | undefined,
): DropLayout | null {
  const origin = root.getBoundingClientRect();
  const place = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left - origin.left + root.scrollLeft,
      right: bounds.right - origin.left + root.scrollLeft,
      top: bounds.top - origin.top + root.scrollTop,
      bottom: bounds.bottom - origin.top + root.scrollTop,
    };
  };
  const measured = lanes.map(({ key, element }) => ({
    key,
    ...place(element),
    rows: [...element.querySelectorAll<HTMLElement>(rowSelector)].flatMap(
      (row) => {
        const id = rowId(row);
        if (!id) return [];
        const { top, bottom } = place(row);
        return [{ id, top, bottom }];
      },
    ),
  }));
  // Without layout (an unrendered surface) there is nothing to resolve.
  return measured.some((lane) => lane.bottom > lane.top)
    ? { lanes: measured }
    : null;
}

/**
 * The drop a pointer at `point` asks for: the lane it is over (or the nearest
 * one within `slack` across and `reach` along the lanes), and the slot between the remaining rows whose midpoint it
 * has passed. Returns null outside every lane and for the dragged row's own
 * slot, so a drop there is no move at all.
 */
export function dropPositionAt(
  layout: DropLayout,
  point: DropPoint,
  draggedId: string,
  { reach = 0, slack = 0 }: { reach?: number; slack?: number } = {},
): DropPosition | null {
  let lane: DropLane | undefined;
  let nearest = Infinity;
  for (const candidate of layout.lanes) {
    const across = outside(point.x, candidate.left, candidate.right);
    const along = outside(point.y, candidate.top, candidate.bottom);
    if (across > slack || along > reach) continue;
    if (across + along < nearest) {
      lane = candidate;
      nearest = across + along;
    }
  }
  if (!lane) return null;
  const sourceIndex = lane.rows.findIndex((row) => row.id === draggedId);
  const rows = lane.rows.filter((row) => row.id !== draggedId);
  let index = rows.findIndex((row) => point.y < (row.top + row.bottom) / 2);
  if (index < 0) index = rows.length;
  if (index === sourceIndex) return null;
  if (index < rows.length)
    return {
      laneKey: lane.key,
      targetId: rows[index]!.id,
      placement: "before",
    };
  if (rows.length)
    return {
      laneKey: lane.key,
      targetId: rows[rows.length - 1]!.id,
      placement: "after",
    };
  return { laneKey: lane.key, placement: "after" };
}

/**
 * Lanes as they will read once the drop lands: the dragged row leaves its
 * lane and takes the slot `drop` names (the end without a target), matching
 * how manual order plans the move.
 */
export function previewDrop<Lane extends { key: string; rows: Row[] }, Row>(
  lanes: readonly Lane[],
  rowId: (row: Row) => string,
  draggedId: string,
  drop: DropPosition | null,
): Lane[] {
  const dragged = lanes
    .flatMap((lane) => lane.rows)
    .find((row) => rowId(row) === draggedId);
  if (!drop || !dragged || !lanes.some((lane) => lane.key === drop.laneKey))
    return [...lanes];
  return lanes.map((lane) => {
    const rows = lane.rows.filter((row) => rowId(row) !== draggedId);
    if (lane.key !== drop.laneKey) {
      return rows.length === lane.rows.length ? lane : { ...lane, rows };
    }
    const target = drop.targetId
      ? rows.findIndex((row) => rowId(row) === drop.targetId)
      : -1;
    const at =
      target < 0 ? rows.length : target + (drop.placement === "after" ? 1 : 0);
    rows.splice(at, 0, dragged);
    return { ...lane, rows };
  });
}

function outside(value: number, start: number, end: number): number {
  return value < start ? start - value : value > end ? value - end : 0;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
