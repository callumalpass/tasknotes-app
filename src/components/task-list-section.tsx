import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** Local display preference only; never changes the saved view or its tasks. */
export function TaskListSection({
  preferenceKey,
  label,
  count,
  arranging = false,
  className = "",
  laneKey,
  children,
}: {
  preferenceKey?: string;
  label: string;
  count: number;
  arranging?: boolean;
  className?: string;
  laneKey: string;
  children: ReactNode;
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return Boolean(
        preferenceKey && localStorage.getItem(preferenceKey) === "collapsed",
      );
    } catch {
      return false;
    }
  });
  const expanded = arranging || !collapsed;
  if (!count && !arranging) return null;
  return (
    <section className={`task-section ${className}`} data-list-lane={laneKey}>
      <h2 className="section-heading">
        <button
          type="button"
          className="task-section-toggle"
          aria-label={`${label} ${count}`}
          aria-expanded={expanded}
          aria-controls={id}
          disabled={arranging}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              if (preferenceKey)
                localStorage.setItem(
                  preferenceKey,
                  next ? "collapsed" : "expanded",
                );
            } catch {
              /* Collapsing still works when preferences cannot be stored. */
            }
          }}
        >
          <ChevronRight aria-hidden="true" size={14} />
          <span>{label}</span>
          <span className="task-section-count">{count}</span>
        </button>
      </h2>
      <div id={id} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
