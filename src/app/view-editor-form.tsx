import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarRange,
  Columns3,
  Folder,
  List,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  ExpressionBuilder,
  type ExpressionField,
} from "../components/expression-builder";
import { MultiValueField } from "../components/multi-value-field";
import {
  TaskNotesCombobox,
  TaskNotesSelect,
} from "../components/tasknotes-controls";

import type { LucideIcon } from "lucide-react";
import type {
  EditableViewDraft,
  EditableViewSort,
  ViewRenderer,
} from "../domain/view-document";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskRepository } from "../storage/repository";

interface ViewEditorFormProps {
  autoFocusName: boolean;
  draft: EditableViewDraft;
  configuration: TaskCollectionConfiguration;
  repository: TaskRepository;
  onChange(draft: EditableViewDraft): void;
  onFilterValidityChange(valid: boolean): void;
}

export function ViewEditorForm({
  autoFocusName,
  draft,
  configuration,
  repository,
  onChange,
  onFilterValidityChange,
}: ViewEditorFormProps) {
  const [propertyInput, setPropertyInput] = useState("");
  const [sortPropertyInput, setSortPropertyInput] = useState("");
  const fields = useMemo(
    () => viewFields(configuration, draft.availableProperties),
    [configuration, draft.availableProperties],
  );
  const selectedFields = draft.properties.map(
    (key) =>
      fields.find((candidate) => candidate.key === key) ??
      field(key, humanize(key)),
  );

  function patch(value: Partial<EditableViewDraft>) {
    onChange({ ...draft, ...value });
  }

  return (
    <div className="view-editor-form">
      <ViewIdentitySection
        autoFocusName={autoFocusName}
        draft={draft}
        onChange={onChange}
      />

      <EditorSection
        description={`Choose which ${
          draft.renderer === "tasknotes.projects" ? "project notes" : "tasks"
        } belong in this view.`}
        id="view-filter"
        title="Filter"
      >
        <ExpressionBuilder
          dialect={draft.dialect}
          fields={fields}
          value={draft.filter}
          onChange={(filter) => patch({ filter })}
          onValidityChange={onFilterValidityChange}
        />
      </EditorSection>

      <EditorSection
        description="Control grouping, order, and the information shown on each item."
        id="view-arrange"
        title="Arrange"
      >
        <div className="view-editor-grid">
          {supportsGrouping(draft.renderer) ? (
            <>
              <div className="view-editor-control-field">
                <span>
                  {draft.renderer === "tasknotes.kanban"
                    ? "Board column"
                    : "Group by"}
                </span>
                <TaskNotesCombobox
                  ariaLabel={
                    draft.renderer === "tasknotes.kanban"
                      ? "Board column"
                      : "Group by"
                  }
                  options={fieldOptions(fields)}
                  placeholder={
                    draft.renderer === "tasknotes.kanban"
                      ? "Choose a property"
                      : "No grouping"
                  }
                  value={draft.groupProperty ?? ""}
                  onChange={(groupProperty) =>
                    patch({ groupProperty: groupProperty || undefined })
                  }
                />
              </div>
              <div className="view-editor-control-field">
                <span>Group direction</span>
                <TaskNotesSelect
                  ariaLabel="Group direction"
                  disabled={!draft.groupProperty}
                  options={[
                    { value: "asc", label: "Ascending" },
                    { value: "desc", label: "Descending" },
                  ]}
                  value={draft.groupDirection}
                  onChange={(groupDirection) =>
                    patch({
                      groupDirection: groupDirection as "asc" | "desc",
                    })
                  }
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="view-editor-subsection">
          <div className="view-editor-subsection-heading">
            <div>
              <h3>Sort</h3>
              <p>Earlier rules take priority.</p>
            </div>
            <span className="view-editor-count">{draft.sort.length}</span>
          </div>
          <SortRules
            fields={fields}
            rules={draft.sort}
            onChange={(sort) => patch({ sort })}
          />
          <div className="add-view-property">
            <TaskNotesCombobox
              ariaLabel="Property to sort"
              options={fieldOptions(fields)}
              placeholder="Add a sort rule"
              value={sortPropertyInput}
              onChange={setSortPropertyInput}
            />
            <button
              disabled={
                !sortPropertyInput.trim() ||
                draft.sort.some(
                  ({ property }) => property === sortPropertyInput.trim(),
                )
              }
              type="button"
              onClick={() => {
                patch({
                  sort: [
                    ...draft.sort,
                    { property: sortPropertyInput.trim(), direction: "asc" },
                  ],
                });
                setSortPropertyInput("");
              }}
            >
              <Plus aria-hidden="true" size={16} /> Add
            </button>
          </div>
        </div>

        <div className="view-editor-subsection">
          <div className="view-editor-subsection-heading">
            <div>
              <h3>Displayed properties</h3>
              <p>Shown in this order below each item.</p>
            </div>
            <span className="view-editor-count">{draft.properties.length}</span>
          </div>
          <PropertyOrder
            fields={selectedFields}
            onMove={(from, to) =>
              patch({ properties: move(draft.properties, from, to) })
            }
            onRemove={(index) =>
              patch({
                properties: draft.properties.filter(
                  (_, candidate) => candidate !== index,
                ),
              })
            }
          />
          <div className="add-view-property">
            <TaskNotesCombobox
              ariaLabel="Property to display"
              options={fieldOptions(fields)}
              placeholder="Add a property"
              value={propertyInput}
              onChange={setPropertyInput}
            />
            <button
              disabled={
                !propertyInput.trim() ||
                draft.properties.includes(propertyInput.trim())
              }
              type="button"
              onClick={() => {
                patch({
                  properties: [...draft.properties, propertyInput.trim()],
                });
                setPropertyInput("");
              }}
            >
              <Plus aria-hidden="true" size={16} /> Add
            </button>
          </div>
        </div>
      </EditorSection>

      {isCalendar(draft.renderer) ? (
        <CalendarOptionsSection draft={draft} onChange={onChange} />
      ) : null}

      <NewTaskSection
        configuration={configuration}
        draft={draft}
        repository={repository}
        onChange={onChange}
      />

      <LayoutPreview draft={draft} fields={fields} />
    </div>
  );
}

function ViewIdentitySection({
  autoFocusName,
  draft,
  onChange,
}: {
  autoFocusName: boolean;
  draft: EditableViewDraft;
  onChange(draft: EditableViewDraft): void;
}) {
  return (
    <EditorSection
      description="Name the view and choose how its results are presented."
      id="view-identity"
      title="View"
    >
      <label className="view-name-field">
        <span>Name</span>
        <input
          autoFocus={autoFocusName}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <fieldset className="view-kind-field">
        <legend>Layout</legend>
        <div className="view-kind-options">
          {layouts.map(({ value, label, description, icon: Icon }) => (
            <button
              aria-label={label}
              aria-pressed={draft.renderer === value}
              key={value}
              type="button"
              onClick={() => onChange(changeRenderer(draft, value))}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
    </EditorSection>
  );
}

function CalendarOptionsSection({
  draft,
  onChange,
}: {
  draft: EditableViewDraft;
  onChange(draft: EditableViewDraft): void;
}) {
  function option(key: string, value: unknown) {
    onChange({
      ...draft,
      options: { ...draft.options, [key]: value },
    });
  }

  return (
    <EditorSection
      description="Choose the calendar mode and which task dates become events."
      id="view-calendar"
      title="Calendar"
    >
      {draft.renderer === "tasknotes.calendar" ? (
        <div className="view-editor-control-field">
          <span>Opens as</span>
          <TaskNotesSelect
            ariaLabel="Opens as"
            options={[
              { value: "dayGridMonth", label: "Month" },
              { value: "timeGridWeek", label: "Week" },
              { value: "timeGridThreeDay", label: "3 days" },
              { value: "timeGridDay", label: "Day" },
              { value: "listWeek", label: "Agenda" },
            ]}
            value={string(draft.options.calendarView) || "dayGridMonth"}
            onChange={(calendarView) => option("calendarView", calendarView)}
          />
        </div>
      ) : null}

      <div className="view-toggle-list">
        <ViewToggle
          checked={draft.options.showScheduled !== false}
          description="Use the configured scheduled field."
          label="Scheduled dates"
          onChange={(checked) => option("showScheduled", checked)}
        />
        <ViewToggle
          checked={draft.options.showDue !== false}
          description="Use the configured due field."
          label="Due dates"
          onChange={(checked) => option("showDue", checked)}
        />
        {draft.renderer === "tasknotes.calendar" ? (
          <>
            <ViewToggle
              checked={draft.options.showRecurring !== false}
              description="Show future virtual occurrences."
              label="Upcoming recurring instances"
              onChange={(checked) => option("showRecurring", checked)}
            />
            <ViewToggle
              checked={draft.options.showCompletedRecurringInstances === true}
              description="Include completed occurrences."
              label="Completed recurring instances"
              onChange={(checked) =>
                option("showCompletedRecurringInstances", checked)
              }
            />
            <ViewToggle
              checked={draft.options.showSkippedRecurringInstances === true}
              description="Include skipped occurrences."
              label="Skipped recurring instances"
              onChange={(checked) =>
                option("showSkippedRecurringInstances", checked)
              }
            />
          </>
        ) : null}
      </div>
    </EditorSection>
  );
}

function NewTaskSection({
  draft,
  configuration,
  repository,
  onChange,
}: {
  draft: EditableViewDraft;
  configuration: TaskCollectionConfiguration;
  repository: TaskRepository;
  onChange(draft: EditableViewDraft): void;
}) {
  const enabled = draft.options.create !== false;
  const defaults = createDefaults(draft);

  return (
    <EditorSection
      description="Set what happens when a task is added from this view."
      id="view-new-tasks"
      title="New tasks"
    >
      <ViewToggle
        checked={enabled}
        description="Keep the quick-add field on this view."
        label="Allow task creation"
        onChange={(checked) => onChange(updateCreateEnabled(draft, checked))}
      />
      {enabled ? (
        <div className="view-create-defaults-fields">
          <div className="view-editor-control-field">
            <span>Status</span>
            <TaskNotesSelect
              ariaLabel="Default status"
              options={[
                { value: "", label: "From the task form" },
                ...configuration.statuses,
              ]}
              value={string(defaults.status)}
              onChange={(status) =>
                onChange(
                  updateCreateDefault(draft, "status", status || undefined),
                )
              }
            />
          </div>
          <div className="view-editor-control-field">
            <span>Priority</span>
            <TaskNotesSelect
              ariaLabel="Default priority"
              options={[
                { value: "", label: "From the task form" },
                ...configuration.priorities,
              ]}
              value={string(defaults.priority)}
              onChange={(priority) =>
                onChange(
                  updateCreateDefault(draft, "priority", priority || undefined),
                )
              }
            />
          </div>
          {(
            [
              [
                "projects",
                "Projects",
                configuration.fieldMapping.projects,
                "Add a project",
              ],
              [
                "contexts",
                "Contexts",
                configuration.fieldMapping.contexts,
                "Add a context",
              ],
              ["tags", "Tags", "tags", "Add a tag"],
            ] as const
          ).map(([key, label, fieldKey, placeholder]) => (
            <MultiValueField
              completeField={(request) => repository.completeField(request)}
              completion={
                configuration.fieldCompletions[fieldKey] ?? { kind: "values" }
              }
              field={fieldKey}
              key={key}
              label={label}
              placeholder={placeholder}
              values={stringList(defaults[key])}
              onChange={(values) =>
                onChange(updateCreateDefault(draft, key, values))
              }
            />
          ))}
          <p className="view-editor-hint">
            Simple filter conditions are also applied when TaskNotes can infer
            them safely.
          </p>
        </div>
      ) : null}
    </EditorSection>
  );
}

function SortRules({
  fields,
  rules,
  onChange,
}: {
  fields: ExpressionField[];
  rules: EditableViewSort[];
  onChange(rules: EditableViewSort[]): void;
}) {
  if (!rules.length)
    return <p className="view-editor-empty-row">Collection order is used.</p>;
  return (
    <div className="view-sort-rules">
      {rules.map((rule, index) => (
        <div key={`${rule.property}:${index}`}>
          <TaskNotesCombobox
            ariaLabel={`Sort property ${index + 1}`}
            options={fieldOptions(fields)}
            value={rule.property}
            onChange={(property) =>
              onChange(
                rules.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, property }
                    : candidate,
                ),
              )
            }
          />
          <TaskNotesSelect
            ariaLabel={`Sort direction ${index + 1}`}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            value={rule.direction}
            onChange={(direction) =>
              onChange(
                rules.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? {
                        ...candidate,
                        direction: direction as "asc" | "desc",
                      }
                    : candidate,
                ),
              )
            }
          />
          <OrderButtons
            count={rules.length}
            index={index}
            label={humanize(rule.property)}
            onMove={(to) => onChange(move(rules, index, to))}
            onRemove={() =>
              onChange(
                rules.filter((_, candidateIndex) => candidateIndex !== index),
              )
            }
          />
        </div>
      ))}
    </div>
  );
}

function PropertyOrder({
  fields,
  onMove,
  onRemove,
}: {
  fields: ExpressionField[];
  onMove(from: number, to: number): void;
  onRemove(index: number): void;
}) {
  if (!fields.length)
    return (
      <p className="view-editor-empty-row">Only the task title is shown.</p>
    );
  return (
    <div className="selected-view-properties">
      {fields.map((selected, index) => (
        <div key={`${selected.key}:${index}`}>
          <span>
            <strong>{selected.label}</strong>
            <small>{selected.key}</small>
          </span>
          <OrderButtons
            count={fields.length}
            index={index}
            label={selected.label}
            onMove={(to) => onMove(index, to)}
            onRemove={() => onRemove(index)}
          />
        </div>
      ))}
    </div>
  );
}

function OrderButtons({
  index,
  count,
  label,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  label: string;
  onMove(to: number): void;
  onRemove(): void;
}) {
  return (
    <div className="view-order-actions">
      <button
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        type="button"
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp aria-hidden="true" size={15} />
      </button>
      <button
        aria-label={`Move ${label} down`}
        disabled={index === count - 1}
        type="button"
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown aria-hidden="true" size={15} />
      </button>
      <button aria-label={`Remove ${label}`} type="button" onClick={onRemove}>
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

function LayoutPreview({
  draft,
  fields,
}: {
  draft: EditableViewDraft;
  fields: ExpressionField[];
}) {
  const propertyLabels = draft.properties
    .slice(0, 3)
    .map(
      (key) =>
        fields.find((candidate) => candidate.key === key)?.label ??
        humanize(key),
    );
  return (
    <section
      aria-labelledby="view-layout-preview-title"
      className={`view-layout-preview is-${rendererName(draft.renderer)}`}
    >
      <div className="view-editor-section-heading">
        <div>
          <p className="eyebrow">Preview</p>
          <h2 id="view-layout-preview-title">
            {draft.name || "Untitled view"}
          </h2>
        </div>
        <small>{layoutLabel(draft.renderer)}</small>
      </div>
      <div aria-hidden="true" className="view-layout-preview-canvas">
        {draft.renderer === "tasknotes.kanban" ? (
          <div className="preview-board">
            {[0, 1, 2].map((column) => (
              <div key={column}>
                <i />
                <span />
                {column !== 2 ? <span /> : null}
              </div>
            ))}
          </div>
        ) : isCalendar(draft.renderer) ? (
          <div className="preview-calendar">
            {Array.from({ length: 21 }, (_, index) => (
              <i
                className={index === 9 || index === 16 ? "has-event" : ""}
                key={index}
              />
            ))}
          </div>
        ) : draft.renderer === "tasknotes.projects" ? (
          <div className="preview-projects">
            <strong />
            <span />
            <span />
            <strong />
            <span />
          </div>
        ) : (
          <div className="preview-list">
            {[0, 1, 2].map((row) => (
              <div key={row}>
                <i />
                <span />
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="view-layout-preview-properties">
        {propertyLabels.length ? propertyLabels.join(" · ") : "Title only"}
      </p>
    </section>
  );
}

function EditorSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="view-editor-section">
      <div className="view-editor-section-heading">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ViewToggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="view-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

const layouts: Array<{
  value: ViewRenderer;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "tasknotes.task-list",
    label: "List",
    description: "Compact rows",
    icon: List,
  },
  {
    value: "tasknotes.kanban",
    label: "Board",
    description: "Grouped columns",
    icon: Columns3,
  },
  {
    value: "tasknotes.calendar",
    label: "Calendar",
    description: "Full schedule",
    icon: CalendarDays,
  },
  {
    value: "tasknotes.mini-calendar",
    label: "Mini calendar",
    description: "Date and agenda",
    icon: CalendarRange,
  },
  {
    value: "tasknotes.projects",
    label: "Projects",
    description: "Linked notes",
    icon: Folder,
  },
];

const defaultFields: ExpressionField[] = [
  field("title", "Title", "text"),
  field("status", "Status", "text"),
  field("priority", "Priority", "text"),
  field("due", "Due", "date"),
  field("scheduled", "Scheduled", "date"),
  field("tags", "Tags", "list"),
  field("projects", "Projects", "list"),
  field("contexts", "Contexts", "list"),
  field("archived", "Archived", "boolean"),
  field("completed", "Completed", "boolean"),
  field("file.name", "File name", "text"),
  field("file.path", "File path", "text"),
];

function viewFields(
  configuration: TaskCollectionConfiguration,
  sourceProperties: string[],
): ExpressionField[] {
  const statuses = configuration.statuses.map((status) => ({
    value: status.value,
    label: status.label,
  }));
  const priorities = configuration.priorities.map((priority) => ({
    value: priority.value,
    label: priority.label,
  }));
  const mapped = Object.entries(configuration.fieldMapping).map(
    ([label, key]) => field(String(key), humanize(label)),
  );
  const custom = configuration.userFields.map((item) =>
    field(
      item.key,
      item.displayName,
      item.type === "text" ? "text" : item.type,
    ),
  );
  const candidates = [
    ...defaultFields.map((candidate) =>
      candidate.key === "status"
        ? { ...candidate, options: statuses }
        : candidate.key === "priority"
          ? { ...candidate, options: priorities }
          : candidate,
    ),
    ...mapped,
    ...custom,
    ...sourceProperties.map((key) => field(key, humanize(key))),
  ];
  const unique = new Map<string, ExpressionField>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
  }
  return [...unique.values()];
}

function field(
  key: string,
  label: string,
  type: ExpressionField["type"] = "text",
): ExpressionField {
  return { key, label, type };
}

function fieldOptions(fields: ExpressionField[]) {
  return fields.map((candidate) => ({
    value: candidate.key,
    label: candidate.label,
  }));
}

function changeRenderer(
  draft: EditableViewDraft,
  renderer: ViewRenderer,
): EditableViewDraft {
  return {
    ...draft,
    renderer,
    ...(renderer === "tasknotes.kanban" && !draft.groupProperty
      ? { groupProperty: "status" }
      : {}),
  };
}

function supportsGrouping(renderer: ViewRenderer): boolean {
  return !isCalendar(renderer) && renderer !== "tasknotes.projects";
}

function isCalendar(renderer: ViewRenderer): boolean {
  return (
    renderer === "tasknotes.calendar" || renderer === "tasknotes.mini-calendar"
  );
}

function createDefaults(draft: EditableViewDraft): Record<string, unknown> {
  return record(record(draft.options.create).defaults);
}

function updateCreateEnabled(
  draft: EditableViewDraft,
  enabled: boolean,
): EditableViewDraft {
  const options = { ...draft.options };
  if (enabled) delete options.create;
  else options.create = false;
  return { ...draft, options };
}

function updateCreateDefault(
  draft: EditableViewDraft,
  key: string,
  value: unknown,
): EditableViewDraft {
  const options = { ...draft.options };
  const create = { ...record(options.create) };
  const defaults = { ...record(create.defaults) };
  if (
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    delete defaults[key];
  else defaults[key] = value;
  if (Object.keys(defaults).length) {
    create.defaults = defaults;
    options.create = create;
  } else {
    delete create.defaults;
    if (Object.keys(create).length) options.create = create;
    else delete options.create;
  }
  return { ...draft, options };
}

function move<T>(values: T[], from: number, to: number): T[] {
  const next = [...values];
  const [value] = next.splice(from, 1);
  next.splice(to, 0, value);
  return next;
}

function rendererName(renderer: ViewRenderer): string {
  return renderer.replace("tasknotes.", "");
}

function layoutLabel(renderer: ViewRenderer): string {
  return layouts.find(({ value }) => value === renderer)?.label ?? "List";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function humanize(value: string): string {
  const bracket = value.match(
    /^(?:note|file|formula|projection)\[["'](.+)["']\]$/,
  );
  const name = bracket
    ? bracket[1]
    : value.includes(".")
      ? value.split(".").at(-1)!
      : value;
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}
