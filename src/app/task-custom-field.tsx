import {
  TaskNotesDateField,
  TaskNotesDateTimeField,
  TaskNotesSelectField,
} from "../components/tasknotes-controls";
import type {
  FieldCompletionRequest,
  FieldCompletion,
} from "../domain/completion";
import type {
  TaskFieldCompletionConfiguration,
  TaskUserMappedField,
} from "../domain/task-configuration";
import { ListField } from "./task-editor-layout";

export function CustomField({
  field,
  value,
  completion,
  completeField,
  onChange,
}: {
  field: TaskUserMappedField;
  value: unknown;
  completion?: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(value: unknown): void;
}) {
  const label = `${field.displayName}${field.required ? " *" : ""}`;
  if (field.inputKind === "enum") {
    const options = (
      field.options ??
      (completion?.kind === "values" ? completion.values : []) ??
      []
    ).map((option) => ({
      value: option.value,
      label: option.label ?? option.value,
    }));
    return (
      <TaskNotesSelectField
        disabled={field.readOnly}
        label={label}
        options={options}
        placeholder={field.required ? "Choose a value" : "No value"}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }
  if (field.inputKind === "datetime") {
    return (
      <TaskNotesDateTimeField
        combineValue={combineSchemaDateTime}
        disabled={field.readOnly}
        label={label}
        splitValue={splitSchemaDateTime}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="form-field boolean-field">
        <span>{label}</span>
        <input
          checked={value === true}
          disabled={field.readOnly}
          required={field.required}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  if (field.type === "list") {
    if (field.readOnly)
      return (
        <label className="form-field">
          <span>{label}</span>
          <input
            readOnly
            value={Array.isArray(value) ? value.map(String).join(", ") : ""}
          />
        </label>
      );
    return (
      <ListField
        field={field.key}
        label={label}
        placeholder="Comma-separated values"
        values={Array.isArray(value) ? value.map(String) : []}
        completion={completion ?? { kind: "values" }}
        completeField={completeField}
        onChange={onChange}
      />
    );
  }
  if (field.type === "date") {
    return (
      <TaskNotesDateField
        disabled={field.readOnly}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        inputMode={field.type === "number" ? "decimal" : undefined}
        readOnly={field.readOnly}
        required={field.required}
        type={field.type === "number" ? "number" : "text"}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        onChange={(event) =>
          onChange(
            field.type === "number" && event.target.value
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    </label>
  );
}

// Schema date-times are instants, unlike floating Scheduled/Due task dates.
function splitSchemaDateTime(value?: string): { date?: string; time?: string } {
  const local = toLocalDateTime(value);
  if (!local) return {};
  const [date, time] = local.split("T");
  return { date, time };
}

function combineSchemaDateTime(
  date?: string,
  time?: string,
): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time ?? "00:00"}:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
