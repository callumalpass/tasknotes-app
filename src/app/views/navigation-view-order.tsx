import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Columns3,
  FolderKanban,
  List,
} from "lucide-react";

import type { TaskView } from "../../domain/view";

export function NavigationViewOrder({
  keys,
  views,
  onMove,
}: {
  keys: string[];
  views: TaskView[];
  onMove(key: string, direction: -1 | 1): void;
}) {
  const ordered = keys.flatMap((key) => {
    const view = views.find((candidate) => candidate.key === key);
    return view ? [view] : [];
  });
  return (
    <section
      className="navigation-view-order"
      aria-labelledby="navigation-view-order-title"
    >
      <header>
        <div>
          <h2 id="navigation-view-order-title">Navigation</h2>
          <p>The first view opens when TaskNotes starts.</p>
        </div>
      </header>
      <ol>
        {ordered.map((view, index) => (
          <li key={view.key}>
            <ViewIcon view={view} />
            <span>{view.name}</span>
            <div className="navigation-order-actions">
              <button
                aria-label={`Move ${view.name} earlier`}
                disabled={index === 0}
                type="button"
                onClick={() => onMove(view.key, -1)}
              >
                <ChevronUp aria-hidden="true" size={17} />
              </button>
              <button
                aria-label={`Move ${view.name} later`}
                disabled={index === ordered.length - 1}
                type="button"
                onClick={() => onMove(view.key, 1)}
              >
                <ChevronDown aria-hidden="true" size={17} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ViewIcon({ view }: { view: TaskView }) {
  const type = view.presentation?.type;
  const Icon =
    type === "tasknotes.projects"
      ? FolderKanban
      : type === "tasknotes.kanban"
        ? Columns3
        : type === "tasknotes.calendar" || type === "tasknotes.mini-calendar"
          ? CalendarDays
          : List;
  return <Icon aria-hidden="true" size={21} strokeWidth={1.55} />;
}
