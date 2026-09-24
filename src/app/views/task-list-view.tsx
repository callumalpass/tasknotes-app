import { GripVertical } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { VirtualTaskList } from "./virtual-task-list";
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
  taskListLaneMoveInput,
  type TaskListLane,
} from "../optimistic-view-reconciliation";
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
}: ViewProps & {
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
    return <ViewEmptyState view={execution.view} stale={execution.stale} />;
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
  if (!manualOrder && execution.rows.length > 100)
    return (
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
      />
    );
  return (
    <ManualTaskRows
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
    />
  );
}

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
}: {
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
  } | null>(null);
  const draggingRef = useRef<typeof dragging>(null);
  const [drop, setDrop] = useState<{
    laneKey: string;
    targetId?: string;
    placement: ManualOrderPlacement;
  } | null>(null);
  const dropRef = useRef(drop);
  const listRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowById = new Map(
    lanes.flatMap((lane) =>
      lane.rows.map((row) => [row.task.id, row] as const),
    ),
  );
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));
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
    draggingRef.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
  }

  function updateDrop(clientX: number, clientY: number) {
    const root = listRef.current;
    const element = document.elementFromPoint(clientX, clientY);
    const laneElement = element?.closest<HTMLElement>("[data-list-lane]");
    if (!root || !laneElement || !root.contains(laneElement)) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const laneKey = laneElement.dataset.listLane;
    if (!laneKey) return;
    const target = element?.closest<HTMLElement>("[data-manual-order-task]");
    const targetId = target?.dataset.manualOrderTask;
    if (targetId && targetId === draggingRef.current?.taskId) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const bounds = target?.getBoundingClientRect();
    const next = {
      laneKey,
      ...(targetId ? { targetId } : {}),
      placement:
        bounds && clientY < bounds.top + bounds.height / 2
          ? ("before" as const)
          : ("after" as const),
    };
    dropRef.current = next;
    setDrop(next);
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

  function finish(row: TaskViewRow) {
    const active = draggingRef.current;
    const destination = dropRef.current;
    clearDrag();
    if (!active || !destination || orderPending || orderUnavailable) return;
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

  const renderRow = (row: TaskViewRow, lane: TaskListLane) => (
    <div
      className={`manual-order-row${dragging?.taskId === row.task.id ? " is-dragging" : ""}${drop?.targetId === row.task.id ? ` is-drop-${drop.placement}` : ""}`}
      data-manual-order-task={row.task.id}
      data-list-lane={lane.key}
      key={row.task.id}
    >
      {manualOrder ? (
        <button
          aria-label={`Reorder ${row.task.title}. Drag, or use up and down arrow keys.`}
          className="manual-order-handle"
          disabled={orderPending || orderUnavailable}
          type="button"
          onKeyDown={(event) => moveWithKeyboard(event, row, lane)}
          onPointerDown={(event) => {
            if (orderPending || orderUnavailable) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            const active = { taskId: row.task.id, sourceLaneKey: lane.key };
            draggingRef.current = active;
            setDragging(active);
            setAnnouncement(`Moving ${row.task.title}.`);
          }}
          onPointerMove={(event) => {
            if (draggingRef.current?.taskId !== row.task.id) return;
            event.preventDefault();
            updateDrop(event.clientX, event.clientY);
          }}
          onPointerCancel={clearDrag}
          onPointerUp={() => finish(row)}
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

  return (
    <>
      <div
        aria-busy={orderPending}
        className={
          grouped
            ? `task-groups saved-view-groups task-list-view${daySections ? " day-task-sections" : ""}`
            : `saved-task-list task-list-view${manualOrder ? " manual-order-list" : ""}`
        }
        ref={listRef}
      >
        {lanes.reduce((total, lane) => total + lane.rows.length, 0) > 100 ? (
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
              showEmpty={Boolean(manualOrder)}
              renderRow={(row, lane) =>
                renderRow(row, laneByKey.get(lane.key)!)
              }
            />
          </div>
        ) : (
          lanes.map((lane) => {
            const rows = (
              <div
                className={`saved-task-list${grouped && manualOrder ? " manual-order-list" : ""}`}
              >
                {lane.rows.map((row) => renderRow(row, lane))}
                {grouped && manualOrder && !lane.rows.length ? (
                  <div className="task-list-empty-drop-zone">Drop here</div>
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
                className={`${lane.className ?? ""}${drop?.laneKey === lane.key ? " is-drop-target" : ""}`}
                laneKey={lane.key}
                key={`${preferenceScope ?? "loading"}:${lane.key}`}
                preferenceKey={
                  preferenceScope
                    ? `tasknotes:section:${preferenceScope}:${lane.key}`
                    : undefined
                }
                label={lane.label ?? "Other"}
                count={lane.rows.length}
                showEmpty={Boolean(manualOrder)}
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
