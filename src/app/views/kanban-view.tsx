import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { KanbanColumnJump } from "../../components/kanban-column-jump";
import { columnLabel, kanbanColumnLabel, valueKey } from "./kanban-columns";
import {
  kanbanPropertyRole,
  type KanbanFieldMapping,
} from "../../domain/kanban";
import {
  type ManualOrderConfiguration,
  type ManualOrderPlacement,
} from "../../domain/manual-order";
import { ViewTaskRow } from "./view-task-row";
import type { TaskViewRow } from "../../domain/view";
import type { ViewProps } from "./view-props";

export function KanbanView({
  execution,
  fieldMapping,
  manualOrder,
  orderPending,
  orderPendingTaskIds,
  moves,
  pendingMoveTaskIds,
  priorityColumns,
  statusColumns,
  onMove,
  onCreateInColumn,
  canCreateInColumn,
  onOpen,
  onToggle,
}: ViewProps & {
  fieldMapping: KanbanFieldMapping;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  orderPendingTaskIds: ReadonlySet<string>;
  pendingMoveTaskIds: ReadonlySet<string>;
  moves: Map<
    string,
    {
      viewKey: string;
      property: string;
      value: unknown;
      sequence: number;
    }
  >;
  priorityColumns: Array<{ value: string; label: string; color?: string }>;
  statusColumns: Array<{ value: string; label: string; color?: string }>;
  onMove(
    row: TaskViewRow,
    property: string,
    value: unknown,
    order?: {
      rows: TaskViewRow[];
      targetId?: string;
      placement: ManualOrderPlacement;
    },
  ): void;
  onCreateInColumn(property: string, value: unknown, label: string): void;
  canCreateInColumn(property: string, value: unknown): boolean;
}) {
  const property = execution.view.presentation?.mappings.column ?? "status";
  const columns = new Map<
    string,
    {
      value: unknown;
      label?: string;
      color?: string;
      rows: typeof execution.rows;
    }
  >();
  const propertyName = kanbanPropertyRole(property, fieldMapping);
  const configuredColumns =
    propertyName === "status"
      ? statusColumns
      : propertyName === "priority"
        ? priorityColumns
        : [];
  for (const configured of configuredColumns)
    columns.set(valueKey(configured.value), {
      value: configured.value,
      label: configured.label,
      color: configured.color,
      rows: [],
    });
  if (propertyName === "completed" || propertyName === "archived") {
    for (const configured of [
      { value: false, label: propertyName === "archived" ? "Active" : "Open" },
      {
        value: true,
        label: propertyName === "archived" ? "Archived" : "Complete",
      },
    ])
      columns.set(valueKey(configured.value), {
        value: configured.value,
        label: configured.label,
        rows: [],
      });
  }
  for (const group of execution.groups) {
    const value = group.values[property] ?? null;
    const existing = columns.get(valueKey(value));
    columns.set(valueKey(value), existing ?? { value, rows: [] });
  }
  for (const row of execution.rows) {
    const value =
      moves.get(row.task.id)?.property === property
        ? moves.get(row.task.id)!.value
        : (row.values[property] ?? row.task.frontmatter[property] ?? null);
    const key = valueKey(value);
    const column = columns.get(key) ?? { value, rows: [] };
    column.rows.push(row);
    columns.set(key, column);
  }
  const orderedColumns = [...columns.values()];
  const writable = propertyName !== null;
  const movable = writable || Boolean(manualOrder);
  const [dragging, setDragging] = useState<{
    row: TaskViewRow;
    sourceKey: string;
    preview: {
      width: number;
      x: number;
      y: number;
      offsetX: number;
      offsetY: number;
    };
  } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overDrop, setOverDrop] = useState<{
    columnKey: string;
    targetId?: string;
    placement: ManualOrderPlacement;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    row: TaskViewRow;
    sourceKey: string;
  } | null>(null);
  const pointerDrag = useRef<{
    pointerId: number;
    row: TaskViewRow;
    sourceKey: string;
    card: HTMLDivElement;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    offsetX: number;
    offsetY: number;
    pointerType: string;
    active: boolean;
    pressTimer: number | null;
  } | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const suppressedClickTaskId = useRef<string | null>(null);
  const suppressedClickTimer = useRef<number | null>(null);
  const overDropRef = useRef<typeof overDrop>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const touchMoveBlocker = useRef<((event: TouchEvent) => void) | null>(null);

  useEffect(
    () => () => {
      if (autoScrollFrame.current !== null)
        cancelAnimationFrame(autoScrollFrame.current);
      const pointer = pointerDrag.current;
      if (pointer?.pressTimer != null) window.clearTimeout(pointer.pressTimer);
      if (touchMoveBlocker.current)
        document.removeEventListener("touchmove", touchMoveBlocker.current, {
          capture: true,
        });
      if (suppressedClickTimer.current !== null)
        window.clearTimeout(suppressedClickTimer.current);
    },
    [],
  );

  function beginMove(
    row: TaskViewRow,
    sourceKey: string,
    pointer: NonNullable<typeof pointerDrag.current>,
  ) {
    const active = { row, sourceKey };
    draggingRef.current = active;
    setDragging({
      ...active,
      preview: {
        width: pointer.width,
        x: pointer.x,
        y: pointer.y,
        offsetX: pointer.offsetX,
        offsetY: pointer.offsetY,
      },
    });
    setOverKey(null);
    setAnnouncement(`Moving ${row.task.title}.`);
  }

  function clearDrag() {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
    const pointer = pointerDrag.current;
    if (pointer?.pressTimer != null) window.clearTimeout(pointer.pressTimer);
    if (pointer?.card.hasPointerCapture(pointer.pointerId))
      pointer.card.releasePointerCapture(pointer.pointerId);
    if (touchMoveBlocker.current) {
      document.removeEventListener("touchmove", touchMoveBlocker.current, {
        capture: true,
      });
      touchMoveBlocker.current = null;
    }
    draggingRef.current = null;
    pointerDrag.current = null;
    pointerPosition.current = null;
    setDragging(null);
    setOverKey(null);
    setOverDrop(null);
    overDropRef.current = null;
  }

  function activatePointerDrag(
    pointer: NonNullable<typeof pointerDrag.current>,
  ) {
    if (pointerDrag.current !== pointer || pointer.active) return;
    if (pointer.pressTimer !== null) {
      window.clearTimeout(pointer.pressTimer);
      pointer.pressTimer = null;
    }
    pointer.active = true;
    pointer.card.setPointerCapture(pointer.pointerId);
    if (pointer.pointerType !== "mouse") {
      const preventTouchMove = (event: TouchEvent) => event.preventDefault();
      touchMoveBlocker.current = preventTouchMove;
      document.addEventListener("touchmove", preventTouchMove, {
        capture: true,
        passive: false,
      });
    }
    pointerPosition.current = { x: pointer.x, y: pointer.y };
    suppressedClickTaskId.current = pointer.row.task.id;
    if (suppressedClickTimer.current !== null)
      window.clearTimeout(suppressedClickTimer.current);
    suppressedClickTimer.current = window.setTimeout(() => {
      suppressedClickTaskId.current = null;
      suppressedClickTimer.current = null;
    }, 700);
    beginMove(pointer.row, pointer.sourceKey, pointer);
  }

  function positionPreview(pointer: NonNullable<typeof pointerDrag.current>) {
    const preview = previewRef.current;
    if (!preview) return;
    preview.style.transform = kanbanPreviewTransform(
      pointer.x,
      pointer.y,
      pointer.offsetX,
      pointer.offsetY,
      pointer.width,
    );
  }

  function updateDropFeedback(next: typeof overDropRef.current) {
    const current = overDropRef.current;
    if (
      current?.columnKey !== next?.columnKey ||
      current?.targetId !== next?.targetId ||
      current?.placement !== next?.placement
    ) {
      overDropRef.current = next;
      setOverDrop(next);
    }
    const nextKey = next?.columnKey ?? null;
    setOverKey((currentKey) => (currentKey === nextKey ? currentKey : nextKey));
  }

  function finishMove(
    row: TaskViewRow,
    sourceKey: string,
    drop: {
      columnKey: string;
      targetId?: string;
      placement: ManualOrderPlacement;
    } | null,
  ) {
    const destination = orderedColumns.find(
      (column) => valueKey(column.value) === drop?.columnKey,
    );
    const changesColumn = drop?.columnKey !== sourceKey;
    if (
      destination &&
      ((!changesColumn && manualOrder) || (changesColumn && writable))
    ) {
      onMove(
        row,
        property,
        destination.value,
        manualOrder
          ? {
              rows: destination.rows,
              targetId: drop?.targetId,
              placement: drop?.placement ?? "after",
            }
          : undefined,
      );
      setAnnouncement(
        changesColumn
          ? `Moved ${row.task.title} to ${destination.label ?? columnLabel(destination.value)}.`
          : `Reordered ${row.task.title}.`,
      );
    }
    clearDrag();
  }

  function dropAt(
    clientX: number,
    clientY: number,
  ): typeof overDropRef.current {
    const board = boardRef.current;
    const bounds = board?.getBoundingClientRect();
    if (
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      (clientX < bounds.left ||
        clientX > bounds.right ||
        clientY < Math.max(0, bounds.top) ||
        clientY > Math.min(window.innerHeight, bounds.bottom))
    )
      return null;
    const element = document.elementFromPoint(clientX, clientY);
    const column = element?.closest<HTMLElement>("[data-kanban-column-key]");
    const columnKey = column?.dataset.kanbanColumnKey;
    if (!columnKey) return null;
    const active = draggingRef.current;
    if (!active || (!manualOrder && columnKey === active.sourceKey))
      return null;
    if (!manualOrder) return { columnKey, placement: "after" };
    const card = element?.closest<HTMLElement>("[data-kanban-card-id]");
    const targetId = card?.dataset.kanbanCardId;
    if (targetId === draggingRef.current?.row.task.id) return null;
    if (!targetId) return { columnKey, placement: "after" };
    const cardBounds = card.getBoundingClientRect();
    return {
      columnKey,
      targetId,
      placement:
        clientY < cardBounds.top + cardBounds.height / 2 ? "before" : "after",
    };
  }

  function continueAutoScroll() {
    autoScrollFrame.current = null;
    const board = boardRef.current;
    const pointer = pointerPosition.current;
    if (!board || !pointer || !pointerDrag.current) return;
    const bounds = board.getBoundingClientRect();
    const horizontalDistance = edgeScrollDistance(
      pointer.x,
      bounds.left,
      bounds.right,
      52,
      18,
    );
    const verticalDistance = edgeScrollDistance(
      pointer.y,
      0,
      window.innerHeight,
      72,
      16,
    );
    if (!horizontalDistance && !verticalDistance) return;

    const previousLeft = board.scrollLeft;
    const previousTop = board.scrollTop;
    if (horizontalDistance) board.scrollLeft += horizontalDistance;
    if (verticalDistance) board.scrollTop += verticalDistance;
    const drop = dropAt(pointer.x, pointer.y);
    updateDropFeedback(drop);
    if (board.scrollLeft !== previousLeft || board.scrollTop !== previousTop)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  function startAutoScroll() {
    if (autoScrollFrame.current === null)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  function startCardPointer(
    event: ReactPointerEvent<HTMLDivElement>,
    row: TaskViewRow,
    sourceKey: string,
  ) {
    if (
      !movable ||
      !event.isPrimary ||
      event.button !== 0 ||
      pointerDrag.current ||
      kanbanDragControl(event.target)
    )
      return;
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const pointer = {
      pointerId: event.pointerId,
      row,
      sourceKey,
      card,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      offsetX: Math.min(
        Math.max(event.clientX - bounds.left, 12),
        Math.max(12, bounds.width - 12),
      ),
      offsetY: Math.min(
        Math.max(event.clientY - bounds.top, 12),
        Math.max(12, bounds.height - 12),
      ),
      pointerType: event.pointerType,
      active: false,
      pressTimer: null as number | null,
    };
    pointerDrag.current = pointer;
    if (event.pointerType !== "mouse") {
      pointer.pressTimer = window.setTimeout(() => {
        activatePointerDrag(pointer);
      }, 220);
    }
  }

  function moveCardPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointerDrag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const distance = Math.hypot(
      pointer.x - pointer.startX,
      pointer.y - pointer.startY,
    );
    if (!pointer.active) {
      if (pointer.pointerType !== "mouse") {
        if (distance > 10) {
          if (pointer.pressTimer !== null)
            window.clearTimeout(pointer.pressTimer);
          pointerDrag.current = null;
        }
        return;
      }
      if (distance < 6) return;
      activatePointerDrag(pointer);
    }
    event.preventDefault();
    positionPreview(pointer);
    pointerPosition.current = { x: pointer.x, y: pointer.y };
    updateDropFeedback(dropAt(pointer.x, pointer.y));
    startAutoScroll();
  }

  function endCardPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointerDrag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (!pointer.active) {
      if (pointer.pressTimer !== null) window.clearTimeout(pointer.pressTimer);
      pointerDrag.current = null;
      return;
    }
    event.preventDefault();
    finishMove(
      pointer.row,
      pointer.sourceKey,
      overDropRef.current ?? dropAt(event.clientX, event.clientY),
    );
  }

  function moveCardWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
    row: TaskViewRow,
    column: (typeof orderedColumns)[number],
    columnIndex: number,
  ) {
    if (event.target !== event.currentTarget) return;
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction) {
      const destination = orderedColumns[columnIndex + direction];
      if (!destination || !writable) return;
      event.preventDefault();
      const rowIndex = column.rows.findIndex(
        ({ task }) => task.id === row.task.id,
      );
      const target =
        manualOrder && destination.rows.length
          ? destination.rows[
              Math.min(Math.max(rowIndex, 0), destination.rows.length - 1)
            ]
          : undefined;
      onMove(
        row,
        property,
        destination.value,
        manualOrder
          ? {
              rows: destination.rows,
              targetId: target?.task.id,
              placement: target ? "before" : "after",
            }
          : undefined,
      );
      setAnnouncement(
        `Moved ${row.task.title} to ${destination.label ?? columnLabel(destination.value)}.`,
      );
      return;
    }
    if (!manualOrder || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
      return;
    const rowIndex = column.rows.findIndex(
      ({ task }) => task.id === row.task.id,
    );
    const vertical = event.key === "ArrowUp" ? -1 : 1;
    const target = column.rows[rowIndex + vertical];
    if (!target) return;
    event.preventDefault();
    onMove(row, property, column.value, {
      rows: column.rows,
      targetId: target.task.id,
      placement: vertical < 0 ? "before" : "after",
    });
    setAnnouncement(`Moved ${row.task.title} ${vertical < 0 ? "up" : "down"}.`);
  }

  return (
    <>
      {!writable ? (
        <p className="view-note">
          This board groups by a calculated property, so cards cannot move
          between columns.
        </p>
      ) : null}
      <KanbanColumnJump
        boardRef={boardRef}
        columns={orderedColumns.map((column) => ({
          key: valueKey(column.value),
          label: kanbanColumnLabel(column, propertyName),
          count: column.rows.length,
        }))}
      />
      <div
        aria-busy={orderPending || pendingMoveTaskIds.size > 0}
        className={`kanban-board${dragging ? " is-dragging" : ""}`}
        aria-label={`${execution.view.name} board`}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !draggingRef.current) return;
          const title = draggingRef.current.row.task.title;
          event.preventDefault();
          clearDrag();
          setAnnouncement(`Cancelled moving ${title}.`);
        }}
        ref={boardRef}
      >
        {orderedColumns.map((column, columnIndex) => {
          const key = valueKey(column.value);
          const label = kanbanColumnLabel(column, propertyName);
          return (
            <section
              aria-label={`${label} column`}
              className={`kanban-column${overKey === key ? " is-drop-target" : ""}`}
              data-kanban-column-key={key}
              key={key}
            >
              <header
                style={
                  propertyName === "status" && column.color
                    ? { borderBottomColor: column.color }
                    : undefined
                }
              >
                <h2
                  style={
                    propertyName === "priority" && column.color
                      ? { color: column.color }
                      : undefined
                  }
                >
                  {label}
                </h2>
                <div>
                  <span>{column.rows.length}</span>
                  {writable && canCreateInColumn(property, column.value) ? (
                    <button
                      aria-label={`Add task to ${label}`}
                      className="kanban-column-add"
                      type="button"
                      onClick={() =>
                        onCreateInColumn(property, column.value, label)
                      }
                    >
                      <Plus aria-hidden="true" size={16} />
                    </button>
                  ) : null}
                </div>
              </header>
              <div className="kanban-column-cards">
                {column.rows.map((row) => {
                  const pending =
                    pendingMoveTaskIds.has(row.task.id) ||
                    orderPendingTaskIds.has(row.task.id);
                  const draggingThisCard =
                    dragging?.row.task.id === row.task.id;
                  return (
                    <div
                      aria-label={
                        movable
                          ? manualOrder
                            ? `${row.task.title}. Drag to move. Use arrow keys to arrange.`
                            : `${row.task.title}. Drag to move between columns. Use left and right arrow keys.`
                          : undefined
                      }
                      aria-busy={pending}
                      className={`kanban-card${movable ? " is-movable" : ""}${pending ? " is-pending" : ""}${draggingThisCard ? " is-dragging" : ""}${manualOrder && overDrop?.targetId === row.task.id ? ` is-drop-${overDrop.placement}` : ""}`}
                      data-kanban-card-id={row.task.id}
                      key={row.task.id}
                      role={movable ? "group" : undefined}
                      tabIndex={movable ? 0 : undefined}
                      onClickCapture={(event) => {
                        if (suppressedClickTaskId.current !== row.task.id)
                          return;
                        suppressedClickTaskId.current = null;
                        if (suppressedClickTimer.current !== null) {
                          window.clearTimeout(suppressedClickTimer.current);
                          suppressedClickTimer.current = null;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onContextMenuCapture={(
                        event: ReactMouseEvent<HTMLDivElement>,
                      ) => {
                        const pointer = pointerDrag.current;
                        if (
                          pointer?.row.task.id !== row.task.id ||
                          (!pointer.active && pointer.pressTimer === null)
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) =>
                        moveCardWithKeyboard(event, row, column, columnIndex)
                      }
                      onPointerCancel={clearDrag}
                      onPointerDown={(event) =>
                        startCardPointer(event, row, key)
                      }
                      onPointerMove={moveCardPointer}
                      onPointerUp={endCardPointer}
                    >
                      <ViewTaskRow
                        row={row}
                        properties={execution.view.properties}
                        titleProperty={fieldMapping.title}
                        omittedProperties={[property]}
                        onOpen={onOpen}
                        onToggle={onToggle}
                      />
                    </div>
                  );
                })}
                {dragging &&
                column.rows.length === 0 &&
                (manualOrder || key !== dragging.sourceKey) ? (
                  <div
                    aria-hidden="true"
                    className={`kanban-empty-drop-zone${overKey === key ? " is-active" : ""}`}
                  >
                    Drop here
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {dragging ? (
        <div
          aria-hidden="true"
          className="kanban-drag-preview"
          data-kanban-drag-preview
          ref={previewRef}
          style={{
            transform: kanbanPreviewTransform(
              dragging.preview.x,
              dragging.preview.y,
              dragging.preview.offsetX,
              dragging.preview.offsetY,
              dragging.preview.width,
            ),
            width: dragging.preview.width,
          }}
        >
          <span>{dragging.row.task.title}</span>
        </div>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function kanbanDragControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest<HTMLElement>(
    "button, a, input, textarea, select, [contenteditable='true']",
  );
  return Boolean(control && !control.classList.contains("task-row-content"));
}

function kanbanPreviewTransform(
  pointerX: number,
  pointerY: number,
  offsetX: number,
  offsetY: number,
  width: number,
): string {
  const inset = 8;
  const x = Math.min(
    Math.max(pointerX - offsetX, inset),
    Math.max(inset, window.innerWidth - width - inset),
  );
  const y = Math.min(
    Math.max(pointerY - offsetY, inset),
    Math.max(inset, window.innerHeight - 82),
  );
  return `translate3d(${x}px, ${y}px, 0)`;
}

function edgeScrollDistance(
  position: number,
  start: number,
  end: number,
  edge: number,
  maximum: number,
): number {
  if (position < start + edge) {
    const intensity = Math.min(1, (start + edge - position) / edge);
    return -Math.max(4, Math.ceil(intensity * maximum));
  }
  if (position > end - edge) {
    const intensity = Math.min(1, (position - (end - edge)) / edge);
    return Math.max(4, Math.ceil(intensity * maximum));
  }
  return 0;
}
