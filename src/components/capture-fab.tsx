import { Trans } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export function CaptureFab({
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      {...props}
      className={`global-capture-fab${className ? ` ${className}` : ""}`}
      type="button"
    >
      <Plus aria-hidden="true" size={24} strokeWidth={1.8} />
      <span>
        <Trans>Add task</Trans>
      </span>
    </button>
  );
}
