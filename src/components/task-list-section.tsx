import {
  sectionCollapsed,
  saveSectionCollapsed,
} from "../application/section-preferences";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** Local display preference only; never changes the saved view or its tasks. */
export function TaskListSection({
  preferenceKey,
  label,
  count,
  arranging = false,
  showEmpty = false,
  className = "",
  laneKey,
  children,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  headingOnly = false,
}: {
  preferenceKey?: string;
  label: string;
  count: number;
  arranging?: boolean;
  showEmpty?: boolean;
  className?: string;
  laneKey: string;
  children: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?(collapsed: boolean): void;
  headingOnly?: boolean;
}) {
  const id = useId();
  const [localCollapsed, setCollapsed] = useState(() =>
    sectionCollapsed(preferenceKey),
  );
  const collapsed = controlledCollapsed ?? localCollapsed;
  const expanded = arranging || !collapsed;
  if (!count && !arranging && !showEmpty) return null;
  return (
    <section className={`task-section ${className}`} data-list-lane={laneKey}>
      <h2 className="section-heading">
        <button
          type="button"
          className="task-section-toggle"
          aria-label={`${label} ${count}`}
          aria-expanded={expanded}
          aria-controls={headingOnly ? undefined : id}
          disabled={arranging}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            onCollapsedChange?.(next);
            saveSectionCollapsed(preferenceKey, next);
          }}
        >
          <ChevronRight aria-hidden="true" size={14} />
          <span>{label}</span>
          <span className="task-section-count">{count}</span>
        </button>
      </h2>
      {!headingOnly ? (
        <div id={id} hidden={!expanded}>
          {expanded ? children : null}
        </div>
      ) : null}
    </section>
  );
}
