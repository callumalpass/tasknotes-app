import { TaskNotesSelect } from "./tasknotes-controls";

const UNITS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
] as const;

type DurationUnit = (typeof UNITS)[number]["value"];

export function DurationField({
  label,
  value,
  optional = false,
  onChange,
}: {
  label: string;
  value: string;
  optional?: boolean;
  onChange(value: string): void;
}) {
  const parsed = simpleDuration(value);

  function change(amount: string, unit: DurationUnit) {
    onChange(amount === "" ? "" : durationValue(amount, unit));
  }

  return (
    <div className="form-field duration-field">
      <span>{label}</span>
      <div className="duration-field-controls">
        <input
          aria-label={`${label} amount`}
          inputMode="numeric"
          min="0"
          placeholder={optional ? "Optional" : "0"}
          step="1"
          type="number"
          value={parsed.amount}
          onChange={(event) => change(event.target.value, parsed.unit)}
        />
        <TaskNotesSelect
          ariaLabel={`${label} unit`}
          options={UNITS}
          value={parsed.unit}
          onChange={(unit) => change(parsed.amount, unit as DurationUnit)}
        />
      </div>
      {!parsed.simple ? (
        <p className="duration-field-current">
          This task uses an advanced duration: <code>{value}</code>
        </p>
      ) : null}
      <details className="duration-field-source" open={!parsed.simple}>
        <summary>Advanced duration</summary>
        <label>
          <span>ISO 8601 value</span>
          <input
            aria-label={`${label} advanced duration`}
            placeholder="For example P1D"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </details>
    </div>
  );
}

function simpleDuration(value: string): {
  amount: string;
  unit: DurationUnit;
  simple: boolean;
} {
  if (!value) return { amount: "", unit: "days", simple: true };
  const patterns: Array<[RegExp, DurationUnit]> = [
    [/^PT(\d+)M$/i, "minutes"],
    [/^PT(\d+)H$/i, "hours"],
    [/^P(\d+)D$/i, "days"],
    [/^P(\d+)W$/i, "weeks"],
  ];
  for (const [pattern, unit] of patterns) {
    const match = pattern.exec(value);
    if (match) return { amount: match[1], unit, simple: true };
  }
  return { amount: "", unit: "days", simple: false };
}

function durationValue(amount: string, unit: DurationUnit): string {
  const normalized = Math.max(0, Math.floor(Number(amount) || 0));
  if (unit === "minutes") return `PT${normalized}M`;
  if (unit === "hours") return `PT${normalized}H`;
  if (unit === "weeks") return `P${normalized}W`;
  return `P${normalized}D`;
}
