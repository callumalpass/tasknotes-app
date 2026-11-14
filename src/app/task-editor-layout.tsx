import { useLingui } from "@lingui/react/macro";
import { ChevronUp, ChevronDown } from "lucide-react";

export function TaskPaneNavigation({
  busy,
  onPrevious,
  onNext,
}: {
  busy: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const { t } = useLingui();
  return (
    <div
      className="task-pane-navigation"
      role="group"
      aria-label={t({ message: "Browse tasks" })}
    >
      <button
        className="icon-action"
        type="button"
        aria-label={t({ message: "Previous task" })}
        title={t({ message: "Previous task (k or Alt+Up)" })}
        aria-keyshortcuts="k Alt+ArrowUp"
        disabled={busy || !onPrevious}
        onClick={onPrevious}
      >
        <ChevronUp aria-hidden="true" size={19} />
      </button>
      <button
        className="icon-action"
        type="button"
        aria-label={t({ message: "Next task" })}
        title={t({ message: "Next task (j or Alt+Down)" })}
        aria-keyshortcuts="j Alt+ArrowDown"
        disabled={busy || !onNext}
        onClick={onNext}
      >
        <ChevronDown aria-hidden="true" size={19} />
      </button>
    </div>
  );
}
