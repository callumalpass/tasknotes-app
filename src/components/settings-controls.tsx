import { useId, type ReactNode } from "react";

/** An immediately applied on/off setting. Saved forms keep checkboxes. */
export function SettingsSwitch({
  label,
  description,
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange(value: boolean): void;
}) {
  const id = useId();
  return (
    <div className="settings-switch">
      <div className="settings-switch-text">
        <label htmlFor={id}>{label}</label>
        {description ? (
          <small id={`${id}-description`}>{description}</small>
        ) : null}
      </div>
      <input
        aria-busy={busy || undefined}
        aria-describedby={description ? `${id}-description` : undefined}
        checked={checked}
        disabled={disabled || busy}
        id={id}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
