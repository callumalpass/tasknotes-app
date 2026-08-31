import {
  CalendarDays,
  ChartNoAxesGantt,
  ChevronDown,
  ChevronUp,
  Columns3,
  FolderKanban,
  GripVertical,
  List,
} from "lucide-react";
import { useRef, useState } from "react";

import type { DragEvent, KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

import type { TaskView } from "../../domain/view";

export function NavigationViewOrder({
  keys,
  specialViews = [],
  views,
  onMove,
}: {
  keys: string[];
  specialViews?: Array<{ key: string; name: string; icon: LucideIcon }>;
  views: TaskView[];
  onMove(key: string, direction: -1 | 1): void;
}) {
  const [reordering, setReordering] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const dragKeyRef = useRef<string | null>(null);
  const ordered: Array<
    | { key: string; name: string; icon: LucideIcon; special: true }
    | (TaskView & { special: false })
  > = [];
  for (const key of keys) {
    const special = specialViews.find((candidate) => candidate.key === key);
    if (special) {
      ordered.push({ ...special, special: true });
      continue;
    }
    const view = views.find((candidate) => candidate.key === key);
    if (view) ordered.push({ ...view, special: false });
  }

  function canMove(index: number, direction: -1 | 1): boolean {
    return moveIsValid(ordered, index, direction);
  }

  function move(index: number, direction: -1 | 1) {
    const view = ordered[index];
    if (!view || !canMove(index, direction)) return;
    onMove(view.key, direction);
    const adjacent = ordered[index + direction];
    setAnnouncement(
      `${view.name} moved ${direction < 0 ? "before" : "after"} ${adjacent?.name}.`,
    );
  }

  function dragOver(event: DragEvent) {
    if (!reordering || dragKeyRef.current === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function drop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const key = dragKeyRef.current;
    dragKeyRef.current = null;
    let sourceIndex = ordered.findIndex((view) => view.key === key);
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const direction = targetIndex < sourceIndex ? -1 : 1;
    const moving = ordered[sourceIndex]!;
    const working = [...ordered];
    while (
      sourceIndex !== targetIndex &&
      moveIsValid(working, sourceIndex, direction)
    ) {
      onMove(moving.key, direction);
      const adjacentIndex = sourceIndex + direction;
      [working[sourceIndex], working[adjacentIndex]] = [
        working[adjacentIndex]!,
        working[sourceIndex]!,
      ];
      sourceIndex = adjacentIndex;
    }
    const adjacent = ordered[targetIndex];
    setAnnouncement(
      sourceIndex === targetIndex
        ? `${moving.name} moved ${direction < 0 ? "before" : "after"} ${adjacent?.name}.`
        : `${moving.name} cannot move past Home.`,
    );
  }

  return (
    <section
      className={`navigation-view-order${reordering ? " is-reordering" : ""}`}
      aria-labelledby="navigation-view-order-title"
    >
      <header>
        <div>
          <div className="section-title-with-count">
            <h2 id="navigation-view-order-title">Shown in navigation</h2>
            <span>{ordered.length}</span>
          </div>
          <p>
            The first saved view is Home. Order and visibility are saved for
            this collection on this device.
          </p>
        </div>
        <button
          aria-pressed={reordering}
          className="text-action navigation-reorder-toggle"
          type="button"
          onClick={() => {
            setReordering((current) => !current);
            setAnnouncement("");
          }}
        >
          {reordering ? "Done" : "Reorder"}
        </button>
      </header>
      <ol>
        {ordered.map((view, index) => {
          const SpecialIcon = view.special ? view.icon : null;
          return (
            <li
              className={reordering ? "is-reorderable" : undefined}
              key={view.key}
              onDragOver={dragOver}
              onDrop={(event) => drop(event, index)}
            >
              {reordering ? (
                <button
                  aria-label={`Drag ${view.name} to reorder`}
                  className="navigation-drag-handle"
                  draggable
                  type="button"
                  onDragEnd={() => {
                    dragKeyRef.current = null;
                  }}
                  onDragStart={(event) => {
                    dragKeyRef.current = view.key;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", view.key);
                    setAnnouncement(`Moving ${view.name}.`);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key === "ArrowUp" && canMove(index, -1)) {
                      event.preventDefault();
                      move(index, -1);
                    } else if (event.key === "ArrowDown" && canMove(index, 1)) {
                      event.preventDefault();
                      move(index, 1);
                    }
                  }}
                >
                  <GripVertical aria-hidden="true" size={18} />
                </button>
              ) : SpecialIcon ? (
                <SpecialIcon aria-hidden="true" size={21} strokeWidth={1.55} />
              ) : (
                <ViewIcon view={view as TaskView} />
              )}
              <span>
                {view.name}
                {index === 0 ? <small>Home</small> : null}
              </span>
              {reordering ? (
                <div className="navigation-order-actions">
                  <button
                    aria-label={`Move ${view.name} earlier`}
                    disabled={!canMove(index, -1)}
                    type="button"
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp aria-hidden="true" size={17} />
                  </button>
                  <button
                    aria-label={`Move ${view.name} later`}
                    disabled={!canMove(index, 1)}
                    type="button"
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown aria-hidden="true" size={17} />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

function moveIsValid(
  ordered: ReadonlyArray<{ special: boolean }>,
  index: number,
  direction: -1 | 1,
): boolean {
  const adjacentIndex = index + direction;
  if (index < 0 || adjacentIndex < 0 || adjacentIndex >= ordered.length)
    return false;
  const proposed = [...ordered];
  [proposed[index], proposed[adjacentIndex]] = [
    proposed[adjacentIndex]!,
    proposed[index]!,
  ];
  return proposed[0]?.special === false;
}

export function ViewIcon({ view }: { view: TaskView }) {
  const type = view.presentation?.type;
  const Icon =
    type === "tasknotes.projects"
      ? FolderKanban
      : type === "tasknotes.planner"
        ? ChartNoAxesGantt
        : type === "tasknotes.kanban"
          ? Columns3
          : type === "tasknotes.calendar" || type === "tasknotes.mini-calendar"
            ? CalendarDays
            : List;
  return <Icon aria-hidden="true" size={21} strokeWidth={1.55} />;
}
