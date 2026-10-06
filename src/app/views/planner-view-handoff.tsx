import { useLingui, Trans, Plural } from "@lingui/react/macro";
import { ExternalLink } from "lucide-react";

export function PlannerViewHandoff({
  href,
  taskCount,
}: {
  href: string;
  taskCount?: number;
}) {
  const { t } = useLingui();
  return (
    <aside className="planner-view-handoff">
      <div>
        <strong>
          <Trans>Continue on the timeline</Trans>
        </strong>
        <span>
          {taskCount === undefined ? (
            t({ message: "Planner will open this saved view." })
          ) : (
            <Plural
              value={taskCount}
              _0="# tasks are ready in this view."
              one="# task is ready in this view."
              other="# tasks are ready in this view."
            />
          )}
        </span>
      </div>
      <a href={href} rel="noreferrer" target="_blank">
        <Trans>Open in Planner</Trans>
        <ExternalLink aria-hidden="true" size={17} strokeWidth={1.7} />
      </a>
    </aside>
  );
}
