import { useState, type ReactNode } from "react";

import { MultiValueField } from "../components/multi-value-field";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskFieldCompletionConfiguration } from "../domain/task-configuration";

export function TaskFormSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="task-form-section"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
      </summary>
      <div className="task-form-section-content">{children}</div>
    </details>
  );
}

export function Fieldset({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="choice-field">
      <legend>{legend}</legend>
      <div>{children}</div>
    </fieldset>
  );
}

export function Choice({
  selected,
  disabled = false,
  children,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "is-selected" : undefined}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ListField({
  field,
  label,
  placeholder,
  values,
  completion,
  completeField,
  valueLabels,
  onChange,
}: {
  field: string;
  label: string;
  placeholder: string;
  values: string[];
  completion: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  valueLabels?: ReadonlyMap<string, string>;
  onChange(values: string[]): void;
}) {
  return (
    <MultiValueField
      completion={completion}
      completeField={completeField}
      field={field}
      label={label}
      placeholder={placeholder}
      values={values}
      valueLabels={valueLabels}
      onChange={onChange}
    />
  );
}
