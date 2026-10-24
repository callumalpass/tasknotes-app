import { Trans } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { useCollapseOnScroll } from "../app/use-collapse-on-scroll";

/**
 * The phone's floating Add task button. It narrows to its icon while the
 * page scrolls down so row actions beneath it stay reachable, and regains
 * its label when scrolling stops or reverses.
 */
export function CaptureFab({
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const collapsed = useCollapseOnScroll();
  return (
    <button
      {...props}
      className={`global-capture-fab${className ? ` ${className}` : ""}${collapsed ? " is-collapsed" : ""}`}
      type="button"
    >
      <Plus aria-hidden="true" size={24} strokeWidth={1.8} />
      <span>
        <Trans>Add task</Trans>
      </span>
    </button>
  );
}
