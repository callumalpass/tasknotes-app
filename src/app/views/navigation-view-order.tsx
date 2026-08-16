import {
  CalendarDays,
  ChartNoAxesGantt,
  ChevronDown,
  ChevronUp,
  Columns3,
  FolderKanban,
  List,
} from "lucide-react";

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
  return (
    <section
      className="navigation-view-order"
      aria-labelledby="navigation-view-order-title"
    >
      <header>
        <div>
          <h2 id="navigation-view-order-title">Navigation</h2>
        </div>
      </header>
      <ol>
        {ordered.map((view, index) => {
          const SpecialIcon = view.special ? view.icon : null;
          return (
            <li key={view.key}>
              {SpecialIcon ? (
                <SpecialIcon aria-hidden="true" size={21} strokeWidth={1.55} />
              ) : (
                <ViewIcon view={view as TaskView} />
              )}
              <span>{view.name}</span>
              <div className="navigation-order-actions">
                <button
                  aria-label={`Move ${view.name} earlier`}
                  disabled={index === 0 || (view.special && index === 1)}
                  type="button"
                  onClick={() => onMove(view.key, -1)}
                >
                  <ChevronUp aria-hidden="true" size={17} />
                </button>
                <button
                  aria-label={`Move ${view.name} later`}
                  disabled={
                    index === ordered.length - 1 || ordered[index + 1]?.special
                  }
                  type="button"
                  onClick={() => onMove(view.key, 1)}
                >
                  <ChevronDown aria-hidden="true" size={17} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
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
