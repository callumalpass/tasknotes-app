import { GripVertical } from "lucide-react";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ReactNode,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { VirtualTaskList } from "./virtual-task-list";
import {
  contentPoint,
  dropPositionAt,
  measureDropLayout,
  prefersReducedMotion,
  previewDrop,
  type DropLayout,
  type DropPosition,
} from "./drop-geometry";
import { useFlipMotion } from "../use-flip-motion";
import { TaskListSection } from "../../components/task-list-section";
import { todayString } from "../../domain/task";
import {
  type ManualOrderConfiguration,
  type ManualOrderPlacement,
} from "../../domain/manual-order";
import { groupTaskViewRows } from "../../domain/view-grouping";
import { sectionTaskViewRows } from "../../domain/task-list-sections";
import { groupLabel } from "../../domain/view-values";
import { ViewTaskRow } from "./view-task-row";
import { ViewEmptyState } from "../view-empty-state";
import {
  applyOptimisticListMoves,
  settledRowCount,
  taskListLaneMoveInput,
  type TaskListLane,
} from "../optimistic-view-reconciliation";
import { TaskDeparturesContext } from "../../components/task-completion-motion";
import type { TaskSummary } from "../../domain/task";
import type { TaskCollectionConfiguration } from "../../domain/task-configuration";
import type { TaskViewProperty, TaskViewRow } from "../../domain/view";
import type { ViewProps } from "./view-props";

export function TaskListView({
  orderUnavailable,
  sectionScope,
  configuration,
  execution,
  moves,
  manualOrder,
  orderPending,
  titleProperty,
  onMove,
  onOpen,
  onToggle,
  sectionAction,
  emptyState,
  daySectionsClear,
}: ViewProps & {
  /** A quiet heading control for a lane, such as Overdue's reschedule. */
  sectionAction?(lane: TaskListLane): ReactNode;
  /** Replaces the generic empty state when the view has no rows at all. */
  emptyState?: ReactNode;
  /** Shown above day sections once Today and Overdue have no rows left. */
  daySectionsClear?: ReactNode;
  orderUnavailable: boolean;
  sectionScope?: string;
  configuration: TaskCollectionConfiguration;
  moves: ReadonlyMap<string, { laneKey: string }>;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  titleProperty: string;
  onMove(
    dragged: TaskViewRow,
    source: TaskListLane,
    destination: TaskListLane,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
}) {
  if (!execution.rows.length)
    return (
      emptyState ?? (
        <ViewEmptyState view={execution.view} stale={execution.stale} />
      )
    );
  const groups = groupTaskViewRows(execution);
  let lanes: TaskListLane[];
  let grouped = false;
  let daySections = false;
  if (groups.length) {
    grouped = true;
    lanes = groups.map((group) => ({
      key: `group:${group.key}`,
      label: Object.keys(group.values).length
        ? groupLabel(Object.entries(group.values))
        : "Other",
      rows: group.rows,
      mutation: { type: "group", values: group.values },
    }));
  } else {
    const sectionMode = execution.view.presentation?.options.sections;
    const sections = sectionTaskViewRows(
      execution.rows,
      sectionMode,
      todayString(),
      { includeEmpty: Boolean(manualOrder) || moves.size > 0 },
    );
    if (sections.length) {
      grouped = true;
      daySections = sectionMode === "day";
      lanes = sections.map((section) => ({
        key: `section:${section.key}`,
        label: section.label,
        className: `is-${section.key}`,
        rows: section.rows,
        mutation: {
          type: "section",
          mode: sectionMode,
          section: section.key,
        },
      }));
    } else {
      lanes = [{ key: "flat", rows: execution.rows }];
    }
  }
  lanes = applyOptimisticListMoves(lanes, execution.rows, moves, manualOrder);
  const clear =
    daySections &&
    daySectionsClear &&
    !lanes.some(
      (lane) =>
        (lane.key === "section:today" || lane.key === "section:overdue") &&
        lane.rows.length,
    )
      ? daySectionsClear
      : null;
  if (!manualOrder && execution.rows.length > 100)
    return (
      <>
        {clear}
        <VirtualTaskList
          key={`${sectionScope}:${execution.view.key}`}
          preferenceScope={
            sectionScope
              ? JSON.stringify([sectionScope, execution.view.key])
              : undefined
          }
          lanes={lanes}
          grouped={grouped}
          daySections={daySections}
          properties={execution.view.properties}
          titleProperty={titleProperty}
          onOpen={onOpen}
          onToggle={onToggle}
          sectionAction={sectionAction}
        />
      </>
    );
  return (
    <ManualTaskRows
      daySectionsClear={clear}
      orderUnavailable={orderUnavailable}
      preferenceScope={
        sectionScope
          ? JSON.stringify([sectionScope, execution.view.key])
          : undefined
      }
      configuration={configuration}
      daySections={daySections}
      grouped={grouped}
      lanes={lanes}
      manualOrder={manualOrder}
      orderPending={orderPending}
      properties={execution.view.properties}
      titleProperty={titleProperty}
      onOpen={onOpen}
      onMove={onMove}
      onToggle={onToggle}
      sectionAction={sectionAction}
    />
  );
}

const ROW_DRAG_THRESHOLD = 6;

function ManualTaskRows({
  orderUnavailable,
  preferenceScope,
  configuration,
  daySections,
  grouped,
  lanes,
  manualOrder,
  orderPending,
  properties,
  titleProperty,
  onOpen,
  onMove,
  onToggle,
  sectionAction,
  daySectionsClear,
}: {
  sectionAction?(lane: TaskListLane): ReactNode;
  daySectionsClear: ReactNode;
  orderUnavailable: boolean;
  configuration: TaskCollectionConfiguration;
  preferenceScope?: string;
  daySections: boolean;
  grouped: boolean;
  lanes: TaskListLane[];
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  properties: TaskViewProperty[];
  titleProperty: string;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onMove(
    dragged: TaskViewRow,
    source: TaskListLane,
    destination: TaskListLane,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void;
}) {
  const [dragging, setDragging] = useState<{
    taskId: string;
    sourceLaneKey: string;
    pointerId: number;
    // Rows part around the drop slot; otherwise a line marks it.
    preview: boolean;
  } | null>(null);
  const draggingRef = useRef<typeof dragging>(null);
  const [drop, setDrop] = useState<DropPosition | null>(null);
  const dropRef = useRef(drop);
  const layoutRef = useRef<DropLayout | null>(null);
  const windowListeners = useRef<(() => void) | null>(null);
  const pressRef = useRef<{
    pointerId: number;
    taskId: string;
    x: number;
    y: number;
  } | null>(null);
  const suppressedClickTaskId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const departing = useContext(TaskDeparturesContext);
  const [announcement, setAnnouncement] = useState("");
  const rowById = new Map(
    lanes.flatMap((lane) =>
      lane.rows.map((row) => [row.task.id, row] as const),
    ),
  );
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));
  const virtualized =
    lanes.reduce((total, lane) => total + lane.rows.length, 0) > 100;
  useFlipMotion(listRef, "data-manual-order-task", !virtualized);
  useEffect(() => () => windowListeners.current?.(), []);
  const firstTask = lanes.flatMap((lane) => lane.rows)[0]?.task;
  const canMoveAcrossLanes = Boolean(
    firstTask &&
    lanes.some(
      (lane) =>
        lane.mutation &&
        taskListLaneMoveInput(firstTask, lane, lane, configuration) !== null,
    ),
  );

  function clearDrag() {
    windowListeners.current?.();
    windowListeners.current = null;
    layoutRef.current = null;
    draggingRef.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
  }

  function setDropPosition(next: DropPosition | null) {
    const current = dropRef.current;
    if (
      current?.laneKey === next?.laneKey &&
      current?.targetId === next?.targetId &&
      current?.placement === next?.placement
    )
      return;
    dropRef.current = next;
    setDrop(next);
  }

  function updateDrop(clientX: number, clientY: number) {
    const root = listRef.current;
    const active = draggingRef.current;
    if (!root || !active) return;
    const layout = layoutRef.current;
    if (layout) {
      setDropPosition(
        dropPositionAt(
          layout,
          contentPoint(root, clientX, clientY),
          active.taskId,
          // Handles sit just outside the rows, and sections are spaced apart.
          { reach: 24, slack: 48 },
        ),
      );
      return;
    }
    // Without a layout (a virtualized list) nothing moves under the pointer,
    // so the live element is the target.
    const element = document.elementFromPoint(clientX, clientY);
    const laneElement = element?.closest<HTMLElement>("[data-list-lane]");
    if (!laneElement || !root.contains(laneElement)) {
      setDropPosition(null);
      return;
    }
    const laneKey = laneElement.dataset.listLane;
    if (!laneKey) return;
    const target = element?.closest<HTMLElement>("[data-manual-order-task]");
    const targetId = target?.dataset.manualOrderTask;
    if (targetId && targetId === active.taskId) {
      setDropPosition(null);
      return;
    }
    const bounds = target?.getBoundingClientRect();
    setDropPosition({
      laneKey,
      ...(targetId ? { targetId } : {}),
      placement:
        bounds && clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }

  function measureLayout(): DropLayout | null {
    const root = listRef.current;
    if (!root || virtualized) return null;
    return measureDropLayout(
      root,
      [
        ...root.querySelectorAll<HTMLElement>(
          "[data-list-lane]:not([data-manual-order-task])",
        ),
      ].flatMap((element) =>
        element.dataset.listLane
          ? [{ key: element.dataset.listLane, element }]
          : [],
      ),
      "[data-manual-order-task]",
      (row) => row.dataset.manualOrderTask,
    );
  }

  function revealLane(key: string) {
    const section = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        "section[data-list-lane]",
      ) ?? []),
    ].find((node) => node.dataset.listLane === key);
    section
      ?.querySelector<HTMLButtonElement>(
        '.task-section-toggle[aria-expanded="false"]',
      )
      ?.click();
  }

  function finish() {
    const active = draggingRef.current;
    const destination = dropRef.current;
    clearDrag();
    const row = active ? rowById.get(active.taskId) : undefined;
    if (!active || !row || !destination || orderPending || orderUnavailable)
      return;
    const sourceLane = laneByKey.get(active.sourceLaneKey);
    const destinationLane = laneByKey.get(destination.laneKey);
    if (!sourceLane || !destinationLane) return;
    const input =
      sourceLane.key === destinationLane.key
        ? {}
        : taskListLaneMoveInput(
            row.task,
            sourceLane,
            destinationLane,
            configuration,
          );
    if (!input) {
      setAnnouncement(
        `${destinationLane.label ?? "That section"} is read-only.`,
      );
      return;
    }
    revealLane(destinationLane.key);
    onMove(
      row,
      sourceLane,
      destinationLane,
      destination.targetId,
      destination.placement,
    );
    const target = destination.targetId
      ? rowById.get(destination.targetId)?.task
      : undefined;
    setAnnouncement(
      sourceLane.key !== destinationLane.key
        ? `Moved ${row.task.title} to ${destinationLane.label ?? "the destination section"}.`
        : target
          ? `Moved ${row.task.title} ${destination.placement} ${target.title}.`
          : `Moved ${row.task.title}.`,
    );
  }

  const live = useRef({ updateDrop, finish, clearDrag });
  useLayoutEffect(() => {
    live.current = { updateDrop, finish, clearDrag };
  });

  function moveWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: TaskViewRow,
    sourceLane: TaskListLane,
  ) {
    if (orderPending || orderUnavailable) return;
    const direction =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    const laneIndex = lanes.findIndex((lane) => lane.key === sourceLane.key);
    const rowIndex = sourceLane.rows.findIndex(
      (candidate) => candidate.task.id === row.task.id,
    );
    const adjacent = sourceLane.rows[rowIndex + direction];
    const destinationLane = adjacent
      ? sourceLane
      : lanes[laneIndex + direction];
    if (!destinationLane) return;
    const target = adjacent
      ? adjacent
      : direction < 0
        ? destinationLane.rows.at(-1)
        : destinationLane.rows[0];
    const input =
      sourceLane.key === destinationLane.key
        ? {}
        : taskListLaneMoveInput(
            row.task,
            sourceLane,
            destinationLane,
            configuration,
          );
    if (!input) return;
    event.preventDefault();
    const crossesLane = sourceLane.key !== destinationLane.key;
    if (crossesLane) revealLane(destinationLane.key);
    onMove(
      row,
      sourceLane,
      destinationLane,
      target?.task.id,
      crossesLane
        ? direction < 0
          ? "after"
          : "before"
        : direction < 0
          ? "before"
          : "after",
    );
    setAnnouncement(
      crossesLane
        ? `Moved ${row.task.title} to ${destinationLane.label ?? "the destination section"}.`
        : `Moved ${row.task.title} ${direction < 0 ? "up" : "down"}.`,
    );
  }

  function startDrag(
    row: TaskViewRow,
    lane: TaskListLane,
    element: HTMLElement,
    pointerId: number,
  ) {
    pressRef.current = null;
    element.setPointerCapture(pointerId);
    const layout = measureLayout();
    layoutRef.current = layout;
    const active = {
      taskId: row.task.id,
      sourceLaneKey: lane.key,
      pointerId,
      preview: layout !== null && !prefersReducedMotion(),
    };
    draggingRef.current = active;
    setDragging(active);
    setAnnouncement(`Moving ${row.task.title}.`);
    // The dragged row moves through the list as its own placeholder, and
    // React may re-insert or remount it, which drops pointer capture; the
    // rest of the gesture is followed on the window instead.
    const ownPointer = (event: PointerEvent) =>
      draggingRef.current?.pointerId === event.pointerId;
    const move = (event: PointerEvent) => {
      if (!ownPointer(event)) return;
      event.preventDefault();
      live.current.updateDrop(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (ownPointer(event)) live.current.finish();
    };
    const cancel = (event: PointerEvent) => {
      if (ownPointer(event)) live.current.clearDrag();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      live.current.clearDrag();
      setAnnouncement(`Cancelled moving ${row.task.title}.`);
    };
    windowListeners.current?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    windowListeners.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }

  // The whole row is a drag surface for mouse and pen. A press only becomes
  // a drag past a few pixels, so clicks on the title and properties still
  // land; touch keeps native scrolling and swipes, and drags by the handle.
  const dragHandlers = (row: TaskViewRow, lane: TaskListLane) =>
    manualOrder
      ? {
          onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
            suppressedClickTaskId.current = null;
            if (
              orderPending ||
              orderUnavailable ||
              !event.isPrimary ||
              event.button !== 0 ||
              draggingRef.current ||
              !(event.target instanceof Element) ||
              event.target.closest(
                "input, textarea, select, [contenteditable='true']",
              )
            )
              return;
            const handle = event.target.closest<HTMLButtonElement>(
              ".manual-order-handle",
            );
            if (handle) {
              event.preventDefault();
              handle.focus();
              startDrag(row, lane, event.currentTarget, event.pointerId);
              return;
            }
            if (event.pointerType === "touch") return;
            pressRef.current = {
              pointerId: event.pointerId,
              taskId: row.task.id,
              x: event.clientX,
              y: event.clientY,
            };
          },
          onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
            const press = pressRef.current;
            if (
              press?.taskId !== row.task.id ||
              press.pointerId !== event.pointerId ||
              Math.hypot(event.clientX - press.x, event.clientY - press.y) <
                ROW_DRAG_THRESHOLD
            )
              return;
            window.getSelection()?.removeAllRanges();
            suppressedClickTaskId.current = row.task.id;
            startDrag(row, lane, event.currentTarget, event.pointerId);
            event.preventDefault();
            updateDrop(event.clientX, event.clientY);
          },
          onPointerUp() {
            pressRef.current = null;
          },
          onPointerCancel() {
            pressRef.current = null;
          },
          onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
            if (suppressedClickTaskId.current !== row.task.id) return;
            suppressedClickTaskId.current = null;
            event.preventDefault();
            event.stopPropagation();
          },
          onDragStart(event: ReactDragEvent<HTMLDivElement>) {
            event.preventDefault();
          },
        }
      : {};

  // While previewing, the dragged row already sits where it will land and the
  // rows around it have parted; only an accepted drop is previewed.
  const dropLane = drop ? laneByKey.get(drop.laneKey) : undefined;
  const sourceLane = dragging
    ? laneByKey.get(dragging.sourceLaneKey)
    : undefined;
  const draggedRow = dragging ? rowById.get(dragging.taskId) : undefined;
  const previewing = Boolean(
    dragging?.preview &&
    drop &&
    dropLane &&
    sourceLane &&
    draggedRow &&
    (dropLane.key === sourceLane.key ||
      taskListLaneMoveInput(
        draggedRow.task,
        sourceLane,
        dropLane,
        configuration,
      ) !== null),
  );
  const shownLanes = previewing
    ? previewDrop<TaskListLane, TaskViewRow>(
        lanes,
        (row) => row.task.id,
        dragging!.taskId,
        drop,
      )
    : lanes;
  const laneOfTask = new Map(
    lanes.flatMap((lane) =>
      lane.rows.map((row) => [row.task.id, lane] as const),
    ),
  );

  const renderRow = (row: TaskViewRow, shownLane: TaskListLane) => {
    const lane = laneOfTask.get(row.task.id) ?? shownLane;
    return (
      <div
        {...dragHandlers(row, lane)}
        className={`manual-order-row${manualOrder && !orderPending && !orderUnavailable ? " is-movable" : ""}${dragging?.taskId === row.task.id ? " is-dragging" : ""}${!dragging?.preview && drop?.targetId === row.task.id ? ` is-drop-${drop.placement}` : ""}`}
        data-manual-order-task={row.task.id}
        data-list-lane={shownLane.key}
        key={row.task.id}
      >
        {manualOrder ? (
          <button
            aria-label={`Reorder ${row.task.title}. Drag, or use up and down arrow keys.`}
            className="manual-order-handle"
            disabled={orderPending || orderUnavailable}
            type="button"
            onKeyDown={(event) => moveWithKeyboard(event, row, lane)}
          >
            <GripVertical aria-hidden="true" size={16} />
          </button>
        ) : null}
        <ViewTaskRow
          row={row}
          properties={properties}
          titleProperty={titleProperty}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      </div>
    );
  };

  // Manual order keeps empty sections as drop targets, so a clear day is
  // told inside the empty Today section rather than above an empty heading.
  const clearInTodayLane = Boolean(
    daySectionsClear && manualOrder && grouped && !virtualized,
  );
  return (
    <>
      {daySectionsClear && !clearInTodayLane ? daySectionsClear : null}
      <div
        aria-busy={orderPending}
        className={`${
          grouped
            ? `task-groups saved-view-groups task-list-view${daySections ? " day-task-sections" : ""}`
            : `saved-task-list task-list-view${manualOrder ? " manual-order-list" : ""}`
        }${dragging?.preview ? " is-previewing-drop" : ""}`}
        ref={listRef}
      >
        {virtualized ? (
          <div className={manualOrder ? "manual-order-list" : undefined}>
            <VirtualTaskList
              lanes={lanes}
              grouped={grouped}
              daySections={daySections}
              preferenceScope={preferenceScope}
              properties={properties}
              titleProperty={titleProperty}
              onOpen={onOpen}
              onToggle={onToggle}
              sectionAction={(lane) =>
                sectionAction?.(laneByKey.get(lane.key)!)
              }
              showEmpty={Boolean(manualOrder)}
              renderRow={(row, lane) =>
                renderRow(row, laneByKey.get(lane.key)!)
              }
            />
          </div>
        ) : (
          shownLanes.map((lane) => {
            const rows = (
              <div
                className={`saved-task-list${grouped && manualOrder ? " manual-order-list" : ""}`}
              >
                {lane.rows.map((row) => renderRow(row, lane))}
                {clearInTodayLane &&
                !dragging &&
                lane.key === "section:today" &&
                !lane.rows.length ? (
                  daySectionsClear
                ) : grouped && manualOrder && !lane.rows.length ? (
                  <div className="task-list-empty-drop-zone">
                    {dragging && canMoveAcrossLanes ? "Drop here" : "No tasks"}
                  </div>
                ) : null}
              </div>
            );
            if (!grouped)
              return (
                <div data-list-lane={lane.key} key={lane.key}>
                  {rows}
                </div>
              );
            return (
              <TaskListSection
                className={`${lane.className ?? ""}${drop?.laneKey === lane.key && !(dragging?.preview && lane.key === dragging.sourceLaneKey) ? " is-drop-target" : ""}`}
                laneKey={lane.key}
                key={`${preferenceScope ?? "loading"}:${lane.key}`}
                preferenceKey={
                  preferenceScope
                    ? `tasknotes:section:${preferenceScope}:${lane.key}`
                    : undefined
                }
                label={lane.label ?? "Other"}
                count={settledRowCount(lane.rows, departing)}
                action={sectionAction?.(lane)}
                showEmpty={Boolean(manualOrder) || lane.rows.length > 0}
              >
                {rows}
              </TaskListSection>
            );
          })
        )}
      </div>
      {manualOrder && grouped && !canMoveAcrossLanes ? (
        <p className="view-note">
          These sections are calculated, so tasks can only be reordered within
          them.
        </p>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
