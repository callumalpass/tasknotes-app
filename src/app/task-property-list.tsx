import { useLingui, Trans } from "@lingui/react/macro";
import {
  AtSign,
  Ban,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Flag,
  Folder,
  Hash,
  Link2,
  ListPlus,
  Plus,
  Repeat,
  SlidersHorizontal,
  Target,
  Timer,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { AssigneeEditor } from "../components/assignee-editor";
import { DependencyEditor } from "../components/dependency-editor";
import { MultiValueField } from "../components/multi-value-field";
import { RecurrenceField } from "../components/recurrence-field";
import { ReminderEditor, reminderSummary } from "../components/reminder-editor";
import { TaskDatePopover } from "../components/task-detail-dates";
import {
  PopoverScrim,
  TaskNotesDatePicker,
  TaskNotesSelect,
  TaskNotesTimePicker,
  useAnchoredPopover,
  useDismissablePopover,
} from "../components/tasknotes-controls";
import { linkDisplayLabel } from "../domain/completion";
import { isEmptyFieldValue } from "../domain/custom-field-value";
import { recurrencePreset } from "../domain/recurrence-rule";
import {
  activeTimeEntry,
  taskDatePart,
  type Task,
  type TaskTimeEntry,
} from "../domain/task";
import {
  statusChoices,
  type TaskCollectionConfiguration,
  type TaskFieldCompletionConfiguration,
  type TaskUserMappedField,
} from "../domain/task-configuration";
import { formatTaskDate, recurrenceLabel } from "../i18n/presentation";
import { OccurrencePolicyField } from "./occurrence-policy-field";
import { useRepository } from "./repository-context";
import { combineSchemaDateTime, splitSchemaDateTime } from "./schema-date-time";
import { timeSummary, type Draft } from "./task-editor-draft";
import { TimeTrackingField } from "./task-time-tracking";
import "./task-property-list.css";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskRelationships } from "../domain/task-relationships";

type Complete = (request: FieldCompletionRequest) => Promise<FieldCompletion[]>;

/** Built-in properties that appear once they hold a value or are added. */
type OptionalKey =
  | "recurrence"
  | "reminders"
  | "time"
  | "tags"
  | "contexts"
  | "assignees"
  | "blockedBy";

export interface TaskTimeActions {
  busy: boolean;
  error: string | null;
  onStart(description?: string): void;
  onStop(): void;
  onReplace(entries: TaskTimeEntry[]): void;
  onRemove(index: number): void;
}

/**
 * A task's properties as one list: the core five always, everything else only
 * once it holds a value, and the rest one step away under Add property.
 */
export function TaskPropertyList({
  task,
  draft,
  configuration,
  projectLabels,
  relationships,
  occurrenceNote,
  seriesDates,
  completeField,
  completeDependencyField,
  time,
  onChange,
}: {
  task: Task;
  draft: Draft;
  configuration: TaskCollectionConfiguration;
  projectLabels: ReadonlyMap<string, string>;
  relationships: TaskRelationships;
  occurrenceNote: boolean;
  seriesDates: boolean;
  completeField: Complete;
  completeDependencyField: Complete;
  time: TaskTimeActions;
  onChange(patch: Partial<Draft>): void;
}) {
  const { t } = useLingui();
  const { repository } = useRepository();
  const listRef = useRef<HTMLDivElement>(null);
  // Shown when the task opened or added since: stays while it is emptied.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(
    () => new Set(keysWithValues(task, draft)),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [openOnMount, setOpenOnMount] = useState<string | null>(null);
  // The row just added takes focus once it has rendered.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const focusKey = pendingFocus.current;
    if (!focusKey) return;
    pendingFocus.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-property-key="${CSS.escape(focusKey)}"]`,
    );
    const target = row?.nextElementSibling?.matches(".task-property-panel")
      ? row.nextElementSibling.querySelector<HTMLElement>(
          "input, button, textarea",
        )
      : row?.querySelector<HTMLElement>(
          ".task-property-value input, .task-property-value button",
        );
    target?.focus();
  });

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const tags = draft.tags.filter((tag) => tag !== "task");
  const blockedByLabels = new Map(
    relationships.blockedBy.flatMap(({ dependency, task }) =>
      task ? [[dependency.uid, task.title] as const] : [],
    ),
  );
  const peopleSupported = Boolean(repository.people);
  const hasValue = optionalValues(task, draft);
  const optionalLabels: Record<OptionalKey, string> = {
    recurrence: t({ message: "Repeat" }),
    reminders: t({ message: "Reminders" }),
    time: t({ message: "Time", context: "time tracking duration" }),
    tags: t({ message: "Tags" }),
    contexts: t({ message: "Contexts" }),
    assignees: t({ message: "Assigned to" }),
    blockedBy: t({ message: "Blocked by" }),
  };
  const optionalIcons: Record<OptionalKey, LucideIcon> = {
    recurrence: Repeat,
    reminders: Bell,
    time: Timer,
    tags: Hash,
    contexts: AtSign,
    assignees: UsersRound,
    blockedBy: Ban,
  };
  const optionalOrder: OptionalKey[] = [
    "recurrence",
    "reminders",
    "time",
    "tags",
    "contexts",
    ...(peopleSupported || hasValue.assignees ? (["assignees"] as const) : []),
    "blockedBy",
  ];
  const shows = (key: OptionalKey) => hasValue[key] || revealed.has(key);
  const customKey = (field: TaskUserMappedField) => `field:${field.key}`;
  const customShows = (field: TaskUserMappedField) =>
    Boolean(field.required) ||
    !isEmptyFieldValue(draft.customProperties[field.key]) ||
    revealed.has(customKey(field));

  const addable = [
    ...optionalOrder
      .filter((key) => !shows(key))
      .map((key) => ({
        key: key as string,
        label: optionalLabels[key],
        Icon: optionalIcons[key],
      })),
    ...configuration.userFields
      .filter((field) => !field.readOnly && !customShows(field))
      .map((field) => ({
        key: customKey(field),
        label: field.displayName,
        Icon: SlidersHorizontal,
      })),
  ];

  function reveal(key: string) {
    setRevealed((current) => new Set(current).add(key));
    const field = key.startsWith("field:")
      ? configuration.userFields.find((item) => customKey(item) === key)
      : undefined;
    // A list opens its picker, which takes focus itself.
    if (key === "tags" || key === "contexts" || field?.type === "list") {
      setOpenOnMount(key);
      return;
    }
    if (expandsInPlace(key))
      setExpanded((current) => new Set(current).add(key));
    pendingFocus.current = key;
  }

  const statusOptions = statusChoices(
    [...configuration.statuses].sort((a, b) => a.order - b.order),
    draft.status,
  );
  const statusColor = configuration.statuses.find(
    (status) => status.value === draft.status,
  )?.color;
  const priorityColor = configuration.priorities.find(
    (priority) => priority.value === draft.priority,
  )?.color;

  return (
    <section
      className="task-property-list"
      aria-label={t({ message: "Task properties" })}
    >
      <div ref={listRef}>
        <SelectRow
          icon={
            <span
              className={`task-property-swatch${statusColor ? "" : " is-plain"}`}
              style={statusColor ? { borderColor: statusColor } : undefined}
            />
          }
          label={t({ message: "Status" })}
          options={statusOptions}
          value={draft.status}
          disabled={occurrenceNote}
          describedBy={occurrenceNote ? "occurrence-status-help" : undefined}
          onChange={(status) => onChange({ status })}
        />
        <SelectRow
          icon={
            <Flag
              size={15}
              strokeWidth={1.8}
              style={priorityColor ? { color: priorityColor } : undefined}
            />
          }
          label={t({ message: "Priority" })}
          options={configuration.priorities}
          value={draft.priority}
          onChange={(priority) => onChange({ priority })}
        />
        <DateRow field="scheduled" draft={draft} onChange={onChange} />
        <DateRow field="due" draft={draft} onChange={onChange} />
        <ListRow
          propertyKey="projects"
          icon={<Folder size={15} strokeWidth={1.8} />}
          label={t({ message: "Project" })}
          field={configuration.fieldMapping.projects}
          values={draft.projects}
          valueLabels={projectLabels}
          usedFirst
          completion={
            configuration.fieldCompletions[
              configuration.fieldMapping.projects
            ] ?? { kind: "records" }
          }
          completeField={completeField}
          onChange={(projects) => onChange({ projects })}
        />

        {shows("recurrence") ? (
          <ExpandRow
            propertyKey="recurrence"
            icon={<Repeat size={15} strokeWidth={1.8} />}
            label={optionalLabels.recurrence}
            summary={
              draft.recurrence
                ? recurrencePreset(draft.recurrence) === "advanced"
                  ? t({ message: "Advanced repeat" })
                  : recurrenceLabel(draft.recurrence)
                : ""
            }
            expanded={expanded.has("recurrence")}
            onToggle={() => toggle("recurrence")}
          >
            <RecurrenceField
              anchor={draft.recurrenceAnchor}
              scheduled={draft.scheduled}
              due={draft.due}
              value={draft.recurrence}
              onAnchorChange={(recurrenceAnchor) =>
                onChange({ recurrenceAnchor })
              }
              onChange={(recurrence) => onChange({ recurrence })}
            />
            {draft.recurrence && !task.occurrenceDate ? (
              <OccurrencePolicyField
                futureHorizon={draft.occurrenceFutureHorizon}
                materialization={draft.occurrenceMaterialization ?? "manual"}
                nextTrigger={draft.occurrenceNextTrigger ?? "completion"}
                pastHorizon={draft.occurrencePastHorizon}
                template={draft.occurrenceTemplate}
                onChange={(patch) => onChange(patch)}
              />
            ) : null}
          </ExpandRow>
        ) : null}

        {shows("reminders") ? (
          <ExpandRow
            propertyKey="reminders"
            icon={<Bell size={15} strokeWidth={1.8} />}
            label={optionalLabels.reminders}
            summary={draft.reminders.map(reminderSummary).join(", ")}
            expanded={expanded.has("reminders")}
            onToggle={() => toggle("reminders")}
          >
            <ReminderEditor
              deliveryMode="mdbase"
              due={draft.due}
              reminders={draft.reminders}
              scheduled={draft.scheduled}
              onChange={(reminders) => onChange({ reminders })}
            />
          </ExpandRow>
        ) : null}

        {shows("time") ? (
          <ExpandRow
            propertyKey="time"
            icon={<Timer size={15} strokeWidth={1.8} />}
            label={optionalLabels.time}
            summary={hasValue.time ? timeSummary(task, draft.timeEstimate) : ""}
            expanded={
              expanded.has("time") || Boolean(activeTimeEntry(task.timeEntries))
            }
            onToggle={() => toggle("time")}
          >
            <label className="form-field time-estimate-field">
              <span>
                <Trans>Estimate (minutes)</Trans>
              </span>
              <input
                inputMode="numeric"
                min="0"
                type="number"
                value={draft.timeEstimate ?? ""}
                onChange={(event) =>
                  onChange({
                    timeEstimate: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
            </label>
            <TimeTrackingField
              busy={time.busy}
              entries={task.timeEntries}
              error={time.error}
              onRemove={time.onRemove}
              onReplace={time.onReplace}
              onStart={time.onStart}
              onStop={time.onStop}
            />
          </ExpandRow>
        ) : null}

        {shows("tags") ? (
          <ListRow
            propertyKey="tags"
            icon={<Hash size={15} strokeWidth={1.8} />}
            label={optionalLabels.tags}
            field="tags"
            values={tags}
            completion={
              configuration.fieldCompletions.tags ?? { kind: "values" }
            }
            completeField={completeField}
            openOnMount={openOnMount === "tags"}
            onChange={(next) => onChange({ tags: ["task", ...next] })}
          />
        ) : null}

        {shows("contexts") ? (
          <ListRow
            propertyKey="contexts"
            icon={<AtSign size={15} strokeWidth={1.8} />}
            label={optionalLabels.contexts}
            field={configuration.fieldMapping.contexts}
            values={draft.contexts}
            completion={
              configuration.fieldCompletions[
                configuration.fieldMapping.contexts
              ] ?? { kind: "values" }
            }
            completeField={completeField}
            openOnMount={openOnMount === "contexts"}
            onChange={(contexts) => onChange({ contexts })}
          />
        ) : null}

        {shows("assignees") ? (
          <ExpandRow
            propertyKey="assignees"
            icon={<UsersRound size={15} strokeWidth={1.8} />}
            label={optionalLabels.assignees}
            summary={(draft.assignees ?? []).map(linkDisplayLabel).join(", ")}
            expanded={expanded.has("assignees")}
            onToggle={() => toggle("assignees")}
          >
            <AssigneeEditor
              taskId={task.id}
              linkWriteFormat={configuration.linkWriteFormat}
              values={draft.assignees ?? []}
              onChange={(assignees) => onChange({ assignees })}
            />
          </ExpandRow>
        ) : null}

        {shows("blockedBy") ? (
          <ExpandRow
            propertyKey="blockedBy"
            icon={<Ban size={15} strokeWidth={1.8} />}
            label={optionalLabels.blockedBy}
            summary={draft.blockedBy
              .map(
                (dependency) =>
                  blockedByLabels.get(dependency.uid) ??
                  linkDisplayLabel(dependency.uid),
              )
              .join(", ")}
            expanded={expanded.has("blockedBy")}
            onToggle={() => toggle("blockedBy")}
          >
            <DependencyEditor
              completeField={completeDependencyField}
              dependencies={draft.blockedBy}
              field={configuration.fieldMapping.blockedBy}
              labels={blockedByLabels}
              onChange={(blockedBy) => onChange({ blockedBy })}
            />
          </ExpandRow>
        ) : null}

        {relationships.blocking.length ? (
          <PropertyRow
            propertyKey="blocking"
            icon={<Link2 size={15} strokeWidth={1.8} />}
            label={t({ message: "Blocking" })}
          >
            <span className="task-property-text">
              {relationships.blocking.map((item) => item.title).join(", ")}
            </span>
          </PropertyRow>
        ) : null}

        {configuration.userFields.filter(customShows).map((field) => (
          <CustomPropertyRow
            key={field.key}
            propertyKey={customKey(field)}
            field={field}
            value={draft.customProperties[field.key]}
            completion={configuration.fieldCompletions[field.key]}
            completeField={completeField}
            openOnMount={openOnMount === customKey(field)}
            onChange={(value) => {
              const customProperties: Draft["customProperties"] = {
                ...draft.customProperties,
              };
              if (isEmptyFieldValue(value)) delete customProperties[field.key];
              else customProperties[field.key] = value;
              onChange({ customProperties });
            }}
          />
        ))}
      </div>

      {addable.length ? (
        <AddPropertyMenu items={addable} onChoose={reveal} />
      ) : null}

      {occurrenceNote ? (
        <p className="field-help" id="occurrence-status-help">
          <Trans>Use the occurrence actions above to change this state.</Trans>
        </p>
      ) : null}
      {seriesDates ? (
        <p className="field-help">
          <Trans>
            These dates edit the repeating task, including future occurrences.
          </Trans>
        </p>
      ) : null}
    </section>
  );
}

function optionalValues(
  task: Task,
  draft: Draft,
): Record<OptionalKey, boolean> {
  return {
    recurrence: Boolean(draft.recurrence),
    reminders: draft.reminders.length > 0,
    time: Boolean(draft.timeEstimate) || task.timeEntries.length > 0,
    tags: draft.tags.some((tag) => tag !== "task"),
    contexts: draft.contexts.length > 0,
    assignees: (draft.assignees ?? []).length > 0,
    blockedBy: draft.blockedBy.length > 0,
  };
}

function keysWithValues(task: Task, draft: Draft): string[] {
  const values = optionalValues(task, draft);
  return [
    ...(Object.keys(values) as OptionalKey[]).filter((key) => values[key]),
    ...Object.entries(draft.customProperties)
      .filter(([, value]) => !isEmptyFieldValue(value))
      .map(([key]) => `field:${key}`),
  ];
}

function expandsInPlace(key: string): boolean {
  return ["recurrence", "reminders", "time", "assignees", "blockedBy"].includes(
    key,
  );
}

function PropertyRow({
  propertyKey,
  icon,
  label,
  labelId,
  empty = false,
  children,
}: {
  propertyKey: string;
  icon: ReactNode;
  label: string;
  labelId?: string;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`task-property-row${empty ? " is-empty" : ""}`}
      data-property-key={propertyKey}
    >
      <span className="task-property-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="task-property-label" id={labelId}>
        {label}
      </span>
      <div className="task-property-value">{children}</div>
    </div>
  );
}

function SelectRow({
  icon,
  label,
  options,
  value,
  disabled,
  describedBy,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  options: Parameters<typeof TaskNotesSelect>[0]["options"];
  value: string;
  disabled?: boolean;
  describedBy?: string;
  onChange(value: string): void;
}) {
  return (
    <PropertyRow propertyKey={label} icon={icon} label={label}>
      <TaskNotesSelect
        ariaLabel={label}
        ariaDescribedBy={describedBy}
        disabled={disabled}
        options={options}
        value={value}
        onChange={onChange}
      />
    </PropertyRow>
  );
}

function DateRow({
  field,
  draft,
  onChange,
}: {
  field: "scheduled" | "due";
  draft: Pick<Draft, "scheduled" | "due">;
  onChange(patch: Partial<Draft>): void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = field === "scheduled" ? t`Scheduled` : t`Due`;
  const value = draft[field];
  return (
    <PropertyRow
      propertyKey={field}
      icon={
        field === "scheduled" ? (
          <CalendarDays size={15} strokeWidth={1.8} />
        ) : (
          <Target size={15} strokeWidth={1.8} />
        )
      }
      label={label}
      empty={!value}
    >
      <button
        ref={trigger}
        aria-description={value ? formatTaskDate(value) : t`No date`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t`${label} date`}
        className="task-property-trigger"
        data-value={value ? taskDatePart(value) : undefined}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value ? formatTaskDate(value) : t`No date`}</span>
      </button>
      {open ? (
        <TaskDatePopover
          draft={draft}
          showTime
          target={field}
          trigger={trigger}
          onClose={() => setOpen(false)}
          onApply={(input) => {
            const patch: Partial<Draft> = {};
            for (const key of ["scheduled", "due"] as const)
              if (key in input) patch[key] = input[key] ?? undefined;
            onChange(patch);
            setOpen(false);
          }}
        />
      ) : null}
    </PropertyRow>
  );
}

function ListRow({
  propertyKey,
  icon,
  label,
  field,
  values,
  valueLabels,
  usedFirst = false,
  completion,
  completeField,
  openOnMount = false,
  onChange,
}: {
  propertyKey: string;
  icon: ReactNode;
  label: string;
  field: string;
  values: string[];
  valueLabels?: ReadonlyMap<string, string>;
  usedFirst?: boolean;
  completion: TaskFieldCompletionConfiguration;
  completeField: Complete;
  openOnMount?: boolean;
  onChange(values: string[]): void;
}) {
  const { t } = useLingui();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { open, present, rootRef, setOpen } = useDismissablePopover(triggerRef);
  useAnchoredPopover({
    open,
    present,
    anchorRef: triggerRef,
    popoverRef,
    sheetOnPhone: true,
  });
  const opened = useRef(false);
  useEffect(() => {
    if (!openOnMount || opened.current) return;
    opened.current = true;
    setOpen(true);
  }, [openOnMount, setOpen]);
  const ariaLabel = label;
  const text = values
    .map((value) => valueLabels?.get(value) ?? linkDisplayLabel(value))
    .join(", ");
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <PropertyRow
      propertyKey={propertyKey}
      icon={icon}
      label={label}
      empty={!values.length}
    >
      <div className="task-property-picker" ref={rootRef}>
        <button
          ref={triggerRef}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t`Edit ${String(label)}`}
          className="task-property-trigger"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span>
            {text || (
              <span className="task-property-empty">
                <Trans>Add</Trans>
              </span>
            )}
          </span>
        </button>
        {present ? (
          <>
            <PopoverScrim
              open={open}
              label={t`Close ${ariaLabel}`}
              onClose={() => setOpen(false)}
            />
            <div
              aria-label={label}
              className="tasknotes-popover task-property-popover"
              data-state={open ? "open" : "closed"}
              inert={!open}
              ref={popoverRef}
              role="dialog"
            >
              <MultiValueField
                autoFocus
                completion={completion}
                completeField={completeField}
                field={field}
                label={label}
                placeholder={t({ message: "Search" })}
                usedFirst={usedFirst}
                values={values}
                valueLabels={valueLabels}
                onChange={onChange}
                onEscape={close}
              />
              <div className="task-property-popover-actions">
                <button className="text-action" type="button" onClick={close}>
                  <Trans>Done</Trans>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PropertyRow>
  );
}

function ExpandRow({
  propertyKey,
  icon,
  label,
  summary,
  expanded,
  onToggle,
  children,
}: {
  propertyKey: string;
  icon: ReactNode;
  label: string;
  summary: string;
  expanded: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const panelId = useId();
  return (
    <>
      <PropertyRow
        propertyKey={propertyKey}
        icon={icon}
        label={label}
        empty={!summary}
      >
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={t`Edit ${String(label)}`}
          className="task-property-trigger"
          type="button"
          onClick={onToggle}
        >
          <span>
            {summary || (
              <span className="task-property-empty">
                <Trans>Add</Trans>
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="task-property-chevron"
            size={15}
            strokeWidth={1.8}
          />
        </button>
      </PropertyRow>
      {expanded ? (
        <div
          className="task-property-panel"
          id={panelId}
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

type CustomKind =
  "select" | "boolean" | "input" | "list" | "date" | "datetime" | "read";

function customFieldKind(field: TaskUserMappedField): CustomKind {
  if (field.readOnly) return "read";
  if (field.inputKind === "enum") return "select";
  if (field.inputKind === "datetime") return "datetime";
  if (field.type === "boolean") return "boolean";
  if (field.type === "list") return "list";
  if (field.type === "date") return "date";
  return "input";
}

function CustomPropertyRow({
  propertyKey,
  field,
  value,
  completion,
  completeField,
  openOnMount,
  onChange,
}: {
  propertyKey: string;
  field: TaskUserMappedField;
  value: unknown;
  completion?: TaskFieldCompletionConfiguration;
  completeField: Complete;
  openOnMount: boolean;
  onChange(value: unknown): void;
}) {
  const { t } = useLingui();
  const label = `${field.displayName}${field.required ? " *" : ""}`;
  const icon = <SlidersHorizontal size={15} strokeWidth={1.8} />;
  const kind = customFieldKind(field);
  if (kind === "list")
    return (
      <ListRow
        propertyKey={propertyKey}
        icon={<ListPlus size={15} strokeWidth={1.8} />}
        label={label}
        field={field.key}
        values={Array.isArray(value) ? value.map(String) : []}
        completion={completion ?? { kind: "values" }}
        completeField={completeField}
        openOnMount={openOnMount}
        onChange={onChange}
      />
    );
  return (
    <PropertyRow
      propertyKey={propertyKey}
      icon={icon}
      label={label}
      empty={isEmptyFieldValue(value)}
    >
      {kind === "read" ? (
        <input
          aria-label={label}
          className="task-property-input"
          readOnly
          value={customSummary(field, value)}
        />
      ) : kind === "date" ? (
        <TaskNotesDatePicker
          ariaLabel={label}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
        />
      ) : kind === "datetime" ? (
        <CustomDateTime label={label} value={value} onChange={onChange} />
      ) : kind === "select" ? (
        <TaskNotesSelect
          ariaLabel={label}
          options={(
            field.options ??
            (completion?.kind === "values" ? completion.values : []) ??
            []
          ).map((option) => ({
            value: option.value,
            label: option.label ?? option.value,
          }))}
          placeholder={
            field.required
              ? t({ message: "Choose a value" })
              : t({ message: "No value" })
          }
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      ) : kind === "boolean" ? (
        <label className="task-property-check">
          <input
            aria-label={label}
            checked={value === true}
            required={field.required}
            type="checkbox"
            onChange={(event) => onChange(event.target.checked)}
          />
          <span aria-hidden="true">
            {value === true ? <Check size={14} strokeWidth={2.4} /> : null}
          </span>
        </label>
      ) : (
        <input
          aria-label={label}
          className="task-property-input"
          inputMode={field.type === "number" ? "decimal" : undefined}
          placeholder={t({ message: "No value" })}
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
      )}
    </PropertyRow>
  );
}

// Schema date-times are instants, unlike floating Scheduled/Due task dates.
function CustomDateTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const { t } = useLingui();
  const { date, time } = splitSchemaDateTime(
    typeof value === "string" ? value : undefined,
  );
  return (
    <div className="task-property-datetime">
      <TaskNotesDatePicker
        ariaLabel={t`${label} date`}
        value={date}
        onChange={(next) => onChange(combineSchemaDateTime(next, time))}
      />
      {date ? (
        <TaskNotesTimePicker
          ariaLabel={t`${label} time`}
          value={time}
          onChange={(next) => onChange(combineSchemaDateTime(date, next))}
        />
      ) : null}
    </div>
  );
}

function customSummary(field: TaskUserMappedField, value: unknown): string {
  if (isEmptyFieldValue(value)) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "string" && field.inputKind === "datetime") {
    const instant = new Date(value);
    return Number.isNaN(instant.valueOf())
      ? value
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(instant);
  }
  if (typeof value === "string" && field.type === "date")
    return formatTaskDate(value);
  return String(value);
}

function AddPropertyMenu({
  items,
  onChoose,
}: {
  items: Array<{ key: string; label: string; Icon: LucideIcon }>;
  onChoose(key: string): void;
}) {
  const { t } = useLingui();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { open, present, rootRef, setOpen, closeAway } =
    useDismissablePopover(triggerRef);
  useAnchoredPopover({
    open,
    present,
    anchorRef: triggerRef,
    popoverRef,
    scrollSelector: ".task-property-menu-items",
    maxScrollHeight: 320,
    sheetOnPhone: true,
  });
  useMenuFocus(open, popoverRef);
  const ariaLabel = t({ message: "Add property" });
  return (
    <div className="task-property-add" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        className="task-property-add-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Plus aria-hidden="true" size={15} strokeWidth={1.9} />
        <Trans>Add property</Trans>
      </button>
      {present ? (
        <>
          <PopoverScrim
            open={open}
            label={t`Close ${ariaLabel}`}
            onClose={() => setOpen(false)}
          />
          <div
            className="tasknotes-popover task-property-menu"
            data-state={open ? "open" : "closed"}
            inert={!open}
            ref={popoverRef}
          >
            <div
              className="task-property-menu-items"
              role="menu"
              aria-label={ariaLabel}
              onKeyDown={(event) => moveMenuFocus(event, popoverRef)}
            >
              {items.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    // The chosen property takes focus, not the Add button.
                    closeAway();
                    onChoose(key);
                  }}
                >
                  <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function useMenuFocus(
  open: boolean,
  popoverRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    popoverRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [open, popoverRef]);
}

function moveMenuFocus(
  event: KeyboardEvent,
  popoverRef: RefObject<HTMLElement | null>,
) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = [
    ...(popoverRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    ) ?? []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  items[next]?.focus();
}
