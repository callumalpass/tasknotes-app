import { editableProperty, type EditableProperty } from "./task-property-kind";
import { useLingui, Trans } from "@lingui/react/macro";
import { X } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { useOverlay } from "./overlays/use-overlay";
import { usePresence } from "./overlays/use-presence";
import { useRepository } from "../app/repository-context";
import { rememberTaskEdit } from "../app/task-edit-undo";
import { ChoiceOptions } from "./choice-options";
import { MultiValueField } from "./multi-value-field";
import {
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
  todayString,
} from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { RecurrenceField } from "./recurrence-field";
import {
  TaskNotesDateField,
  TaskNotesDateTimeField,
  TaskNotesSelectField,
} from "./tasknotes-controls";

import type { TaskSummary } from "../domain/task";
import { propertyValue, updateFor } from "./task-property-input";
import type {
  TaskCollectionConfiguration,
  TaskUserMappedField,
} from "../domain/task-configuration";
import type { TaskPropertyEditorAnchor, TaskRowDetail } from "./task-row";

export function TaskPropertyEditor({
  task,
  detail,
  anchor: triggerAnchor,
  occurrenceDate,
  open = true,
  onClose,
  onExited,
}: {
  task: TaskSummary;
  detail: TaskRowDetail;
  anchor: TaskPropertyEditorAnchor;
  occurrenceDate?: string;
  /** False while the editor plays its exit before `onExited`. */
  open?: boolean;
  onClose(): void;
  onExited?(): void;
}) {
  const { t } = useLingui();
  const { configuration, repository, updateTask } = useRepository();
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
  const editorRef = useRef<HTMLElement>(null);
  const [desktopPosition, setDesktopPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const position = () => {
      if (window.innerWidth <= 600) {
        setDesktopPosition(null);
        return;
      }
      const gutter = 12;
      const width = editor.offsetWidth;
      const expandedHeight =
        property?.kind === "scheduled" ||
        property?.kind === "due" ||
        property?.kind === "recurrence"
          ? Math.min(540, window.innerHeight - gutter * 2)
          : editor.offsetHeight;
      setDesktopPosition({
        top: Math.max(
          gutter,
          Math.min(
            triggerAnchor.bottom + 6,
            window.innerHeight - expandedHeight - gutter,
          ),
        ),
        left: Math.max(
          gutter,
          Math.min(triggerAnchor.left, window.innerWidth - width - gutter),
        ),
      });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [property?.kind, triggerAnchor]);

  const scrimRef = useRef<HTMLDivElement>(null);
  const present = usePresence(open, scrimRef, onExited);
  useOverlay({
    open,
    rootRef: editorRef,
    modal: window.innerWidth <= 600,
    onDismiss: onClose,
    initialFocus: () =>
      editorRef.current?.querySelector<HTMLElement>(
        ".choice-options input, .multi-value-field input",
      ) ?? closeRef.current,
  });

  async function save(next: unknown, closeAfter = true) {
    if (!property || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = updateFor(task, property, next, anchor);
      const saved = await updateTask(task.id, input);
      const title = task.title;
      rememberTaskEdit({
        before: task,
        saved,
        input,
        notice: t`Updated “${title}”`,
        getSummary: (id) => repository.getSummary(id),
        updateTask,
      });
      if (closeAfter) onClose();
      else setSaving(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t({ message: "The change could not be saved." }),
      );
      setSaving(false);
    }
  }

  if (!present) return null;
  return createPortal(
    <div
      aria-hidden={open ? undefined : true}
      className="task-property-editor-scrim"
      data-state={open ? "open" : "closed"}
      inert={!open}
      ref={scrimRef}
      role="presentation"
    >
      <section
        aria-label={t`Edit ${detail.label}`}
        aria-modal={desktopPosition ? undefined : "true"}
        className="task-property-editor"
        ref={editorRef}
        role="dialog"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (property?.kind !== "projects" || event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        style={
          desktopPosition
            ? ({
                "--task-property-editor-top": `${desktopPosition.top}px`,
                "--task-property-editor-left": `${desktopPosition.left}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <header>
          <div>
            <span>
              <Trans>Edit property</Trans>
            </span>
            <h2>{detail.label}</h2>
          </div>
          <button
            aria-label={t({ message: "Close property editor" })}
            ref={closeRef}
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>
        {occurrenceDate ? (
          <p className="task-property-editor-note">
            <Trans>
              This edits the repeating task, including future occurrences.
            </Trans>
          </p>
        ) : null}
        {property?.kind === "scheduled" || property?.kind === "due" ? (
          <div
            className="task-date-shortcuts"
            role="group"
            aria-label={t({ message: "Quick dates" })}
          >
            {[
              [t({ message: "Today" }), 0],
              [t({ message: "Tomorrow" }), 1],
              [t({ message: "In one week" }), 7],
            ].map(([label, days]) => (
              <button
                key={label}
                type="button"
                disabled={saving}
                onClick={() => {
                  const date = shiftTaskDate(todayString(), Number(days));
                  void save(
                    combineTaskDateTime(
                      date,
                      taskTimePart(
                        typeof value === "string" ? value : undefined,
                      ),
                    ),
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {property ? (
          <PropertyControl
            configuration={configuration}
            property={property}
            scheduled={task.scheduled}
            due={task.due}
            value={value}
            anchor={anchor}
            disabled={saving}
            onAnchorChange={setAnchor}
            onChange={setValue}
            onCommit={(next) => void save(next)}
            onPersist={(next) => void save(next, false)}
          />
        ) : (
          <p className="task-property-editor-note">
            <Trans>
              This value is calculated by the view and cannot be edited here.
            </Trans>
          </p>
        )}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {property && canClear(property) ? (
          <button
            className="task-property-editor-clear text-action"
            disabled={saving}
            type="button"
            onClick={() => void save(undefined)}
          >
            <Trans>Clear value</Trans>
          </button>
        ) : null}
        {property &&
        ["recurrence", "projects", "tags", "contexts"].includes(
          property.kind,
        ) ? (
          <footer>
            <span />
            <button
              className="primary-action"
              disabled={saving}
              type="button"
              onClick={() => {
                const pendingProject = [
                  "projects",
                  "tags",
                  "contexts",
                ].includes(property.kind)
                  ? editorRef.current
                      ?.querySelector<HTMLInputElement>(
                        ".multi-value-field input",
                      )
                      ?.value.trim()
                  : "";
                const projects = Array.isArray(value) ? value : [];
                const next =
                  pendingProject &&
                  !projects.some(
                    (project: string) =>
                      project.toLocaleLowerCase() ===
                      pendingProject.toLocaleLowerCase(),
                  )
                    ? [...projects, pendingProject]
                    : value;
                void save(next);
              }}
            >
              {saving ? t({ message: "Saving…" }) : t({ message: "Save" })}
            </button>
          </footer>
        ) : !property ? (
          <footer>
            <span />
            <button
              className="secondary-action"
              type="button"
              onClick={onClose}
            >
              <Trans>Close</Trans>
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

export function PropertyControl({
  configuration,
  property,
  scheduled,
  due,
  value,
  anchor,
  disabled,
  onChange,
  onCommit,
  onPersist,
  onAnchorChange,
  compactChoices = false,
}: {
  configuration: TaskCollectionConfiguration;
  property: EditableProperty;
  scheduled?: string;
  due?: string;
  value: unknown;
  anchor?: "scheduled" | "completion";
  disabled: boolean;
  onChange(value: unknown): void;
  onCommit(value: unknown): void;
  onPersist(value: unknown): void;
  onAnchorChange(value: "scheduled" | "completion"): void;
  compactChoices?: boolean;
}) {
  const { t } = useLingui();
  const { repository } = useRepository();
  if (
    property.kind === "projects" ||
    property.kind === "tags" ||
    property.kind === "contexts"
  )
    return (
      <MultiValueField
        label={
          property.kind === "projects"
            ? t`Projects`
            : property.kind === "tags"
              ? t`Tags`
              : t`Contexts`
        }
        field={
          property.kind === "tags"
            ? "tags"
            : configuration.fieldMapping[property.kind]
        }
        placeholder={property.kind === "projects" ? t`Find a project` : t`Add`}
        values={Array.isArray(value) ? value : []}
        completion={
          configuration.fieldCompletions[
            property.kind === "tags"
              ? "tags"
              : configuration.fieldMapping[property.kind]
          ] ?? { kind: property.kind === "projects" ? "records" : "values" }
        }
        completeField={(request) => repository.completeField(request)}
        onChange={onChange}
      />
    );
  if (property.kind === "status" || property.kind === "priority") {
    const options =
      property.kind === "status"
        ? configuration.statuses
        : configuration.priorities;
    if (compactChoices)
      return (
        <TaskNotesSelectField
          label={property.kind === "status" ? t`Status` : t`Priority`}
          options={options}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={onCommit}
        />
      );
    return (
      <ChoiceOptions
        label={
          property.kind === "status"
            ? t({ message: "Status" })
            : t({ message: "Priority" })
        }
        options={options}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChoose={(next) => {
          onChange(next);
          onCommit(next);
        }}
      />
    );
  }
  if (property.kind === "scheduled" || property.kind === "due")
    return (
      <TaskNotesDateTimeField
        disabled={disabled}
        label={
          property.kind === "scheduled"
            ? t({ message: "Scheduled" })
            : t({ message: "Due" })
        }
        value={typeof value === "string" ? value : undefined}
        splitValue={(current) => ({
          date: taskDatePart(current) || undefined,
          time: taskTimePart(current) || undefined,
        })}
        combineValue={combineTaskDateTime}
        onChange={(next) => {
          onChange(next);
          onPersist(next);
        }}
      />
    );
  if (property.kind === "recurrence")
    return (
      <RecurrenceField
        anchor={anchor}
        scheduled={scheduled}
        due={due}
        value={typeof value === "string" ? value : undefined}
        onAnchorChange={onAnchorChange}
        onChange={(next) => {
          onChange(next);
          onCommit(next);
        }}
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
        placeholder={t({ message: "No value" })}
        value={typeof value === "string" ? value : ""}
        onChange={(next) => {
          onChange(next);
          onPersist(next);
        }}
      />
    );
  if (field.inputKind === "datetime")
    return (
      <TaskNotesDateTimeField
        disabled={disabled}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={(next) => {
          onChange(next);
          onPersist(next);
        }}
      />
    );
  if (field.type === "date")
    return (
      <TaskNotesDateField
        disabled={disabled}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={(next) => {
          onChange(next);
          onPersist(next);
        }}
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
          onChange={(event) => {
            onChange(event.target.checked);
            onCommit(event.target.checked);
          }}
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
          onChange(customInputValue(field.type, event.target.value))
        }
        onBlur={(event) =>
          onCommit(customInputValue(field.type, event.currentTarget.value))
        }
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onCommit(customInputValue(field.type, event.currentTarget.value));
        }}
      />
    </label>
  );
}

function customInputValue(
  type: TaskUserMappedField["type"],
  value: string,
): unknown {
  if (type === "number") return value === "" ? undefined : Number(value);
  if (type === "list")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return value;
}

function canClear(property: EditableProperty): boolean {
  return (
    property.kind === "scheduled" ||
    property.kind === "due" ||
    property.kind === "recurrence" ||
    property.kind === "projects" ||
    property.kind === "tags" ||
    property.kind === "contexts" ||
    (property.kind === "custom" && !property.field.required)
  );
}
