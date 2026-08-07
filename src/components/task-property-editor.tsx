import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import {
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { RecurrenceField } from "./recurrence-field";
import {
  TaskNotesDateField,
  TaskNotesDateTimeField,
  TaskNotesSelectField,
} from "./tasknotes-controls";

import type { UpdateTaskInput, Task } from "../domain/task";
import type {
  TaskCollectionConfiguration,
  TaskUserMappedField,
} from "../domain/task-configuration";
import type { TaskRowDetail } from "./task-row";

type EditableProperty =
  | {
      kind: "status" | "priority" | "scheduled" | "due" | "recurrence";
      key: string;
    }
  | { kind: "custom"; key: string; field: TaskUserMappedField };

export function TaskPropertyEditor({
  task,
  detail,
  occurrenceDate,
  onClose,
}: {
  task: Task;
  detail: TaskRowDetail;
  occurrenceDate?: string;
  onClose(): void;
}) {
  const { configuration, updateTask } = useRepository();
  const property = useMemo(
    () => editableProperty(detail.key, configuration),
    [configuration, detail.key],
  );
  const initial = detail.rawValue ?? propertyValue(task, property);
  const [value, setValue] = useState<unknown>(initial);
  const [anchor, setAnchor] = useState(task.recurrenceAnchor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  async function save(next: unknown = value) {
    if (!property || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateTask(task.id, updateFor(task, property, next, anchor));
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The change could not be saved.",
      );
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="task-property-editor-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={`Edit ${detail.label}`}
        aria-modal="true"
        className="task-property-editor"
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <span>Edit property</span>
            <h2>{detail.label}</h2>
          </div>
          <button
            aria-label="Close property editor"
            ref={closeRef}
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>
        {occurrenceDate ? (
          <p className="task-property-editor-note">
            This edits the repeating task, including future occurrences.
          </p>
        ) : null}
        {property ? (
          <PropertyControl
            configuration={configuration}
            property={property}
            scheduled={task.scheduled}
            value={value}
            anchor={anchor}
            disabled={saving}
            onAnchorChange={setAnchor}
            onChange={setValue}
          />
        ) : (
          <p className="task-property-editor-note">
            This value is calculated by the view and cannot be edited here.
          </p>
        )}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {property ? (
          <footer>
            {canClear(property) ? (
              <button
                className="text-action"
                disabled={saving}
                type="button"
                onClick={() => void save(undefined)}
              >
                Clear value
              </button>
            ) : (
              <span />
            )}
            <div>
              <button
                className="secondary-action"
                disabled={saving}
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={saving}
                type="button"
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Apply"}
              </button>
            </div>
          </footer>
        ) : (
          <footer>
            <span />
            <button
              className="secondary-action"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

function PropertyControl({
  configuration,
  property,
  scheduled,
  value,
  anchor,
  disabled,
  onChange,
  onAnchorChange,
}: {
  configuration: TaskCollectionConfiguration;
  property: EditableProperty;
  scheduled?: string;
  value: unknown;
  anchor?: "scheduled" | "completion";
  disabled: boolean;
  onChange(value: unknown): void;
  onAnchorChange(value: "scheduled" | "completion"): void;
}) {
  if (property.kind === "status" || property.kind === "priority") {
    const options =
      property.kind === "status"
        ? configuration.statuses
        : configuration.priorities;
    return (
      <TaskNotesSelectField
        disabled={disabled}
        label={property.kind === "status" ? "Status" : "Priority"}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }
  if (property.kind === "scheduled" || property.kind === "due")
    return (
      <TaskNotesDateTimeField
        disabled={disabled}
        label={property.kind === "scheduled" ? "Scheduled" : "Due"}
        value={typeof value === "string" ? value : undefined}
        splitValue={(current) => ({
          date: taskDatePart(current) || undefined,
          time: taskTimePart(current) || undefined,
        })}
        combineValue={combineTaskDateTime}
        onChange={onChange}
      />
    );
  if (property.kind === "recurrence")
    return (
      <RecurrenceField
        anchor={anchor}
        scheduled={scheduled}
        value={typeof value === "string" ? value : undefined}
        onAnchorChange={onAnchorChange}
        onChange={onChange}
      />
    );

  if (property.kind !== "custom") return null;
  const field = property.field;
  const label = field.displayName;
  if (field.inputKind === "enum")
    return (
      <TaskNotesSelectField
        disabled={disabled}
        label={label}
        options={(field.options ?? []).map((option) => ({
          value: option.value,
          label: option.label ?? option.value,
        }))}
        placeholder="No value"
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  if (field.inputKind === "datetime")
    return (
      <TaskNotesDateTimeField
        disabled={disabled}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  if (field.type === "date")
    return (
      <TaskNotesDateField
        disabled={disabled}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  if (field.type === "boolean")
    return (
      <label className="form-field boolean-field">
        <span>{label}</span>
        <input
          checked={value === true}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        inputMode={field.type === "number" ? "decimal" : undefined}
        type={field.type === "number" ? "number" : "text"}
        value={
          field.type === "list" && Array.isArray(value)
            ? value.join(", ")
            : typeof value === "string" || typeof value === "number"
              ? value
              : ""
        }
        onChange={(event) =>
          onChange(
            field.type === "number"
              ? event.target.value === ""
                ? undefined
                : Number(event.target.value)
              : field.type === "list"
                ? event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                : event.target.value,
          )
        }
      />
    </label>
  );
}

function editableProperty(
  key: string,
  configuration: TaskCollectionConfiguration,
): EditableProperty | null {
  if (key.startsWith("file.")) return null;
  const normalized = notePropertyName(key);
  const semantic = (
    ["status", "priority", "scheduled", "due", "recurrence"] as const
  ).find(
    (kind) =>
      normalized === kind || normalized === configuration.fieldMapping[kind],
  );
  if (semantic) return { kind: semantic, key: normalized };
  const field = configuration.userFields.find(
    (candidate) => candidate.key === normalized,
  );
  return field && !field.readOnly
    ? { kind: "custom", key: normalized, field }
    : null;
}

function notePropertyName(key: string): string {
  if (key.startsWith("note.")) return key.slice(5);
  return /^note\[(["'])(.+)\1\]$/.exec(key)?.[2] ?? key;
}

function propertyValue(task: Task, property: EditableProperty | null): unknown {
  if (!property) return undefined;
  return property.kind === "custom"
    ? task.customProperties[property.key]
    : task[property.kind];
}

function updateFor(
  task: Task,
  property: EditableProperty,
  value: unknown,
  anchor?: "scheduled" | "completion",
): UpdateTaskInput {
  if (property.kind === "custom") {
    const customProperties = { ...task.customProperties };
    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && !value.length)
    )
      delete customProperties[property.key];
    else customProperties[property.key] = value;
    return { customProperties };
  }
  if (
    property.kind === "scheduled" ||
    property.kind === "due" ||
    property.kind === "recurrence"
  )
    return {
      [property.kind]: typeof value === "string" && value ? value : null,
      ...(property.kind === "recurrence" && anchor
        ? { recurrenceAnchor: anchor }
        : {}),
    };
  return { [property.kind]: String(value) };
}

function canClear(property: EditableProperty): boolean {
  return (
    property.kind === "scheduled" ||
    property.kind === "due" ||
    property.kind === "recurrence" ||
    (property.kind === "custom" && !property.field.required)
  );
}
