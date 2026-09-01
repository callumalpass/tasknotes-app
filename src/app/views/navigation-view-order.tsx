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

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";

import type { TaskView } from "../../domain/view";
import { selectionFeedback } from "../../native/feedback";

type NavigationDropPlacement = "before" | "after";
type NavigationDragState = {
  sourceKey: string;
  targetKey?: string;
  placement?: NavigationDropPlacement;
};
type OrderedNavigationView =
  | { key: string; name: string; icon: LucideIcon; special: true }
  | (TaskView & { special: false });

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
  const [drag, setDrag] = useState<NavigationDragState | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const ordered: OrderedNavigationView[] = [];
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

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    sourceIndex: number,
  ) {
    if (event.button !== 0) return;
    const source = ordered[sourceIndex];
    if (!source) return;
    event.preventDefault();
    let active: NavigationDragState = { sourceKey: source.key };
    setDrag(active);
    setAnnouncement(`Moving ${source.name}.`);

    const movePointer = (pointer: PointerEvent) => {
      const element = document.elementFromPoint(
        pointer.clientX,
        pointer.clientY,
      );
      const row = element?.closest<HTMLElement>("[data-navigation-view]");
      const root = listRef.current;
      const targetKey = row?.dataset.navigationView;
      if (!root || !row || !root.contains(row) || !targetKey) {
        active = { sourceKey: source.key };
        setDrag(active);
        return;
      }
      const targetIndex = ordered.findIndex((view) => view.key === targetKey);
      const bounds = row.getBoundingClientRect();
      const placement: NavigationDropPlacement =
        pointer.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      if (
        targetIndex === sourceIndex ||
        !dropIsValid(ordered, sourceIndex, targetIndex, placement)
      ) {
        active = { sourceKey: source.key };
        setDrag(active);
        return;
      }
      active = { sourceKey: source.key, targetKey, placement };
      setDrag(active);
    };

    const clear = () => {
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    const finish = () => {
      clear();
      if (!active.targetKey || !active.placement) return;
      const targetIndex = ordered.findIndex(
        (view) => view.key === active.targetKey,
      );
      const finalIndex = dropFinalIndex(
        sourceIndex,
        targetIndex,
        active.placement,
      );
      const direction: -1 | 1 = finalIndex < sourceIndex ? -1 : 1;
      const working = [...ordered];
      let currentIndex = sourceIndex;
      while (
        currentIndex !== finalIndex &&
        moveIsValid(working, currentIndex, direction)
      ) {
        onMove(source.key, direction);
        const adjacentIndex = currentIndex + direction;
        [working[currentIndex], working[adjacentIndex]] = [
          working[adjacentIndex]!,
          working[currentIndex]!,
        ];
        currentIndex = adjacentIndex;
      }
      const target = ordered[targetIndex];
      setAnnouncement(
        `${source.name} moved ${active.placement} ${target?.name}.`,
      );
      selectionFeedback();
    };
    const cancel = () => clear();

    window.addEventListener("pointermove", movePointer);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
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
            The first view is Home. Order and visibility are saved for this
            collection on this device.
          </p>
        </div>
        <button
          aria-pressed={reordering}
          className="text-action navigation-reorder-toggle"
          type="button"
          onClick={() => {
            setReordering((current) => !current);
            setAnnouncement("");
            setDrag(null);
          }}
        >
          {reordering ? "Done" : "Reorder"}
        </button>
      </header>
      <ol ref={listRef}>
        {ordered.map((view, index) => {
          const SpecialIcon = view.special ? view.icon : null;
          const dropTarget =
            drag?.targetKey === view.key ? drag.placement : null;
          return (
            <li
              className={`${reordering ? "is-reorderable" : ""}${drag?.sourceKey === view.key ? " is-dragging" : ""}${dropTarget ? ` is-drop-${dropTarget}` : ""}`.trim()}
              data-navigation-view={view.key}
              key={view.key}
            >
              {reordering ? (
                <button
                  aria-label={`Move ${view.name}. Drag, or use up and down arrow keys.`}
                  className="navigation-drag-handle"
                  type="button"
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key === "ArrowUp" && canMove(index, -1)) {
                      event.preventDefault();
                      move(index, -1);
                    } else if (event.key === "ArrowDown" && canMove(index, 1)) {
                      event.preventDefault();
                      move(index, 1);
                    }
                  }}
                  onPointerDown={(event) => beginDrag(event, index)}
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

function dropFinalIndex(
  sourceIndex: number,
  targetIndex: number,
  placement: NavigationDropPlacement,
): number {
  if (placement === "before")
    return sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  return sourceIndex < targetIndex ? targetIndex : targetIndex + 1;
}

function dropIsValid(
  ordered: ReadonlyArray<unknown>,
  sourceIndex: number,
  targetIndex: number,
  placement: NavigationDropPlacement,
): boolean {
  const finalIndex = dropFinalIndex(sourceIndex, targetIndex, placement);
  if (finalIndex === sourceIndex) return false;
  const direction: -1 | 1 = finalIndex < sourceIndex ? -1 : 1;
  const working = [...ordered];
  let currentIndex = sourceIndex;
  while (currentIndex !== finalIndex) {
    if (!moveIsValid(working, currentIndex, direction)) return false;
    const adjacentIndex = currentIndex + direction;
    [working[currentIndex], working[adjacentIndex]] = [
      working[adjacentIndex]!,
      working[currentIndex]!,
    ];
    currentIndex = adjacentIndex;
  }
  return true;
}

function moveIsValid(
  ordered: ReadonlyArray<unknown>,
  index: number,
  direction: -1 | 1,
): boolean {
  const adjacentIndex = index + direction;
  return index >= 0 && adjacentIndex >= 0 && adjacentIndex < ordered.length;
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
