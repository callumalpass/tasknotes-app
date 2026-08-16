import { ExternalLink } from "lucide-react";

export function PlannerViewHandoff({
  href,
  taskCount,
}: {
  href: string;
  taskCount?: number;
}) {
  return (
    <aside className="planner-view-handoff">
      <div>
        <strong>Continue on the timeline</strong>
        <span>
          {taskCount === undefined
            ? "Planner will open this saved view."
            : `${taskCount} ${taskCount === 1 ? "task is" : "tasks are"} ready in this view.`}
        </span>
      </div>
      <a href={href} rel="noreferrer" target="_blank">
        Open in Planner
        <ExternalLink aria-hidden="true" size={17} strokeWidth={1.7} />
      </a>
    </aside>
  );
}
