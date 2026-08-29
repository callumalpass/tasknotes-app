import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarRange,
  ChartNoAxesGantt,
  ChevronDown,
  Columns3,
  List,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ExpressionBuilder,
  type ExpressionField,
} from "../components/expression-builder";
import { MultiValueField } from "../components/multi-value-field";
import {
  TaskNotesCombobox,
  TaskNotesSelect,
} from "../components/tasknotes-controls";
import { validateComputedProperties } from "../domain/view-computed-properties";
import {
  computedPropertyReference,
  suggestedFilterAndSortFields,
} from "../domain/view-document";
import { isManualOrderProperty } from "../domain/manual-order";

import type { LucideIcon } from "lucide-react";
import type {
  EditableViewDraft,
  EditableViewSort,
  ViewRenderer,
} from "../domain/view-document";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskRepository } from "../application/ports/task-repository";

interface ViewEditorFormProps {
  autoFocusName: boolean;
  draft: EditableViewDraft;
  configuration: TaskCollectionConfiguration;
  repository: TaskRepository;
  sourcePath?: string;
  onChange(draft: EditableViewDraft): void;
  onFilterValidityChange(valid: boolean): void;
  onComputedValidityChange(valid: boolean): void;
}

export function ViewEditorForm({
  autoFocusName,
  draft,
  configuration,
  repository,
  sourcePath,
  onChange,
  onFilterValidityChange,
  onComputedValidityChange,
}: ViewEditorFormProps) {
  const [propertyInput, setPropertyInput] = useState("");
  const [sortPropertyInput, setSortPropertyInput] = useState("");
  const [openSection, setOpenSection] = useState<string | null>(null);
  const fields = useMemo(
    () =>
      viewFields(configuration, [
        ...draft.availableProperties,
        ...draft.computedProperties.map(({ name }) =>
          computedPropertyReference(draft.dialect, name.trim()),
        ),
      ]),
    [
      configuration,
      draft.availableProperties,
      draft.computedProperties,
      draft.dialect,
    ],
  );
  const filterAndSortFields = useMemo(
    () => suggestedFilterAndSortFields(draft.dialect, fields),
    [draft.dialect, fields],
  );
  const computedError = useMemo(
    () => validateComputedProperties(draft.dialect, draft.computedProperties),
    [draft.computedProperties, draft.dialect],
  );
  useEffect(() => {
    onComputedValidityChange(!computedError);
  }, [computedError, onComputedValidityChange]);
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
        description="Choose which tasks belong in this view."
        id="view-filter"
        open={openSection === "view-filter"}
        summary={draft.filter ? "Custom filter" : "All tasks"}
        title="Filter"
        onOpenChange={(open) => setOpenSection(open ? "view-filter" : null)}
      >
        <ExpressionBuilder
          dialect={draft.dialect}
          fields={filterAndSortFields}
          value={draft.filter}
          onChange={(filter) => patch({ filter })}
          onValidityChange={onFilterValidityChange}
        />
      </EditorSection>

      <EditorSection
        description="Choose how tasks are grouped and ordered."
        id="view-group-sort"
        open={openSection === "view-group-sort"}
        summary={groupSortSummary(draft)}
        title="Group & sort"
        onOpenChange={(open) => setOpenSection(open ? "view-group-sort" : null)}
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

        <div className="view-editor-subsection view-editor-subsection-first">
          <div className="view-editor-subsection-heading">
            <div>
              <h3>Sort</h3>
              <p>Earlier rules take priority.</p>
            </div>
            <span className="view-editor-count">{draft.sort.length}</span>
          </div>
          <SortRules
            fields={filterAndSortFields}
            rules={draft.sort}
            onChange={(sort) => patch({ sort })}
          />
          {draft.sort.some(({ property }) =>
            isManualOrderProperty(
              property,
              configuration.fieldMapping.sortOrder,
            ),
          ) ? (
            <p className="view-editor-hint">
              {draft.sort[0] &&
              isManualOrderProperty(
                draft.sort[0].property,
                configuration.fieldMapping.sortOrder,
              )
                ? "Manual order is active. Drag handles will appear on tasks."
                : "Move Manual order to the first position to enable drag handles."}
            </p>
          ) : null}
          <div className="add-view-property">
            <TaskNotesCombobox
              ariaLabel="Property to sort"
              options={fieldOptions(filterAndSortFields)}
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
                    {
                      property: sortPropertyInput.trim(),
                      direction: isManualOrderProperty(
                        sortPropertyInput.trim(),
                        configuration.fieldMapping.sortOrder,
                      )
                        ? "desc"
                        : "asc",
                    },
                  ],
                });
                setSortPropertyInput("");
              }}
            >
              <Plus aria-hidden="true" size={16} /> Add
            </button>
          </div>
        </div>
      </EditorSection>

      <EditorSection
        description="Choose the information shown beneath each task."
        id="view-fields"
        open={openSection === "view-fields"}
        summary={fieldsSummary(draft)}
        title="Fields shown"
        onOpenChange={(open) => setOpenSection(open ? "view-fields" : null)}
      >
        <div className="view-editor-subsection view-editor-subsection-first">
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
        <CalendarOptionsSection
          draft={draft}
          open={openSection === "view-calendar"}
          onChange={onChange}
          onOpenChange={(open) => setOpenSection(open ? "view-calendar" : null)}
        />
      ) : null}

      <NewTaskSection
        configuration={configuration}
        draft={draft}
        open={openSection === "view-new-tasks"}
        repository={repository}
        onChange={onChange}
        onOpenChange={(open) => setOpenSection(open ? "view-new-tasks" : null)}
      />

      <ComputedPropertiesSection
        draft={draft}
        error={computedError}
        open={openSection === "view-advanced"}
        sourcePath={sourcePath}
        onChange={onChange}
        onOpenChange={(open) => setOpenSection(open ? "view-advanced" : null)}
      />
    </div>
  );
}

function ComputedPropertiesSection({
  draft,
  error,
  open,
  sourcePath,
  onChange,
  onOpenChange,
}: {
  draft: EditableViewDraft;
  error: string;
  open: boolean;
  sourcePath?: string;
  onChange(draft: EditableViewDraft): void;
  onOpenChange(open: boolean): void;
}) {
  const noun = draft.dialect === "obsidian-bases" ? "formula" : "projection";

  return (
    <EditorSection
      description="Formulas and source details for this saved view."
      id="view-advanced"
      open={open}
      summary={[
        draft.computedProperties.length
          ? `${draft.computedProperties.length} ${draft.computedProperties.length === 1 ? noun : `${noun}s`}`
          : `No ${noun}s`,
        sourcePath ? "Source file" : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      title="Advanced"
      onOpenChange={onOpenChange}
    >
      <div className="view-editor-subsection-heading">
        <div>
          <h3>
            {draft.dialect === "obsidian-bases" ? "Formulas" : "Projections"}
          </h3>
          <p>
            {draft.dialect === "obsidian-bases"
              ? "Reusable values for filters, grouping, sorting, and fields."
              : "Reusable values for grouping and displayed fields."}
          </p>
        </div>
        <span className="view-editor-count">
          {draft.computedProperties.length}
        </span>
      </div>
      {draft.computedProperties.length ? (
        <div className="view-computed-properties">
          {draft.computedProperties.map((property, index) => {
            const reference = computedPropertyReference(
              draft.dialect,
              property.name.trim() || "name",
            );
            return (
              <div
                className="view-computed-property"
                key={`${property.scope}:${property.originalName ?? "new"}:${index}`}
              >
                <label>
                  <span>Name</span>
                  <input
                    aria-label={`Computed property name ${index + 1}`}
                    spellCheck={false}
                    value={property.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        computedProperties: replace(
                          draft.computedProperties,
                          index,
                          { ...property, name: event.target.value },
                        ),
                      })
                    }
                  />
                </label>
                {draft.dialect === "mdbase-cel" ? (
                  <label>
                    <span>Available in</span>
                    <TaskNotesSelect
                      ariaLabel={`Computed property scope ${index + 1}`}
                      options={[
                        { value: "view", label: "This view" },
                        { value: "source", label: "Every view in this file" },
                      ]}
                      value={property.scope}
                      onChange={(scope) =>
                        onChange({
                          ...draft,
                          computedProperties: replace(
                            draft.computedProperties,
                            index,
                            {
                              ...property,
                              scope: scope as "source" | "view",
                            },
                          ),
                        })
                      }
                    />
                  </label>
                ) : null}
                <label className="view-computed-expression">
                  <span>Expression</span>
                  <textarea
                    aria-label={`Computed property expression ${index + 1}`}
                    rows={2}
                    spellCheck={false}
                    value={property.expression}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        computedProperties: replace(
                          draft.computedProperties,
                          index,
                          { ...property, expression: event.target.value },
                        ),
                      })
                    }
                  />
                </label>
                <div className="view-computed-property-footer">
                  <code>{reference}</code>
                  <button
                    aria-label={`Remove computed property ${property.name || index + 1}`}
                    className="quiet-icon"
                    type="button"
                    onClick={() =>
                      onChange({
                        ...draft,
                        computedProperties: draft.computedProperties.filter(
                          (_, candidate) => candidate !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="view-editor-empty-row">No computed properties.</p>
      )}
      <div className="view-computed-actions">
        <button
          type="button"
          onClick={() =>
            onChange({
              ...draft,
              computedProperties: [
                ...draft.computedProperties,
                {
                  name: nextComputedName(draft.computedProperties),
                  expression: "",
                  scope: draft.dialect === "obsidian-bases" ? "source" : "view",
                },
              ],
            })
          }
        >
          <Plus aria-hidden="true" size={15} /> Add {noun}
        </button>
        {draft.dialect === "obsidian-bases" ? (
          <small>
            These formulas are shared by views in the same source file.
          </small>
        ) : null}
      </div>
      <p
        className={error ? "expression-status is-error" : "expression-status"}
        role={error ? "alert" : undefined}
      >
        {error ||
          (draft.computedProperties.length
            ? "Computed properties are valid"
            : "")}
      </p>
      {sourcePath ? (
        <div className="view-source-details">
          <span>Source file</span>
          <code>{sourcePath}</code>
        </div>
      ) : null}
    </EditorSection>
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
    <section className="view-identity" aria-labelledby="view-identity-title">
      <div className="view-identity-heading">
        <h2 id="view-identity-title">View details</h2>
        <p>Name this view and choose its layout.</p>
      </div>
      <label className="view-name-field">
        <span>View name</span>
        <input
          aria-label="View name"
          autoFocus={autoFocusName}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <fieldset className="view-kind-field">
        <legend>Layout</legend>
        <div className="view-kind-options">
          {layouts.map(({ value, label, description, icon: Icon }) => (
            <label key={value}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <input
                aria-label={label}
                checked={draft.renderer === value}
                name="view-layout"
                type="radio"
                value={value}
                onChange={() => onChange(changeRenderer(draft, value))}
              />
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function CalendarOptionsSection({
  draft,
  open,
  onChange,
  onOpenChange,
}: {
  draft: EditableViewDraft;
  open: boolean;
  onChange(draft: EditableViewDraft): void;
  onOpenChange(open: boolean): void;
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
      open={open}
      summary={calendarSummary(draft)}
      title="Calendar"
      onOpenChange={onOpenChange}
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
  open,
  repository,
  onChange,
  onOpenChange,
}: {
  draft: EditableViewDraft;
  configuration: TaskCollectionConfiguration;
  open: boolean;
  repository: TaskRepository;
  onChange(draft: EditableViewDraft): void;
  onOpenChange(open: boolean): void;
}) {
  const enabled = draft.options.create !== false;
  const defaults = createDefaults(draft);

  return (
    <EditorSection
      description="Set what happens when a task is added from this view."
      id="view-new-tasks"
      open={open}
      summary={newTaskSummary(enabled, defaults)}
      title="New tasks"
      onOpenChange={onOpenChange}
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
            Defaults inferred from simple filter conditions are added when the
            task is created.
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

function EditorSection({
  id,
  title,
  description,
  summary = description,
  open,
  children,
  onOpenChange,
}: {
  id: string;
  title: string;
  description: string;
  summary?: string;
  open: boolean;
  children: React.ReactNode;
  onOpenChange(open: boolean): void;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`view-editor-section${open ? " is-open" : ""}`}
    >
      <button
        aria-controls={`${id}-content`}
        aria-expanded={open}
        className="view-editor-section-heading"
        type="button"
        onClick={(event) => {
          const section = event.currentTarget.closest<HTMLElement>(
            ".view-editor-section",
          );
          onOpenChange(!open);
          if (!open && section && typeof section.scrollIntoView === "function")
            requestAnimationFrame(() =>
              section.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
                block: "start",
              }),
            );
        }}
      >
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{summary}</p>
        </div>
        <ChevronDown aria-hidden="true" size={18} strokeWidth={1.7} />
      </button>
      {open ? (
        <div className="view-editor-section-content" id={`${id}-content`}>
          {children}
        </div>
      ) : null}
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
    value: "tasknotes.planner",
    label: "Planner",
    description: "Timeline handoff",
    icon: ChartNoAxesGantt,
  },
];

function groupSortSummary(draft: EditableViewDraft): string {
  const parts = [
    draft.groupProperty ? `Grouped by ${humanize(draft.groupProperty)}` : "",
    draft.sort.length
      ? `${draft.sort.length} ${draft.sort.length === 1 ? "sort" : "sorts"}`
      : "Collection order",
  ].filter(Boolean);
  return parts.join(" · ");
}

function fieldsSummary(draft: EditableViewDraft): string {
  return draft.properties.length
    ? `${draft.properties.length} ${draft.properties.length === 1 ? "field" : "fields"}`
    : "Title only";
}

function calendarSummary(draft: EditableViewDraft): string {
  const dates = [
    draft.options.showDue !== false ? "due" : "",
    draft.options.showScheduled !== false ? "scheduled" : "",
  ].filter(Boolean);
  const mode =
    draft.renderer === "tasknotes.calendar"
      ? calendarModeLabel(string(draft.options.calendarView))
      : "Mini calendar";
  return dates.length ? `${mode} · ${dates.join(" and ")}` : mode;
}

function calendarModeLabel(value: string): string {
  return (
    {
      dayGridMonth: "Month",
      timeGridWeek: "Week",
      timeGridThreeDay: "3 days",
      timeGridDay: "Day",
      listWeek: "Agenda",
    }[value || "dayGridMonth"] ?? "Month"
  );
}

function newTaskSummary(
  enabled: boolean,
  defaults: Record<string, unknown>,
): string {
  if (!enabled) return "Task creation off";
  const count = Object.keys(defaults).length;
  return count
    ? `${count} ${count === 1 ? "default" : "defaults"}`
    : "Task creation on";
}

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
    ([label, key]) =>
      field(
        String(key),
        label === "sortOrder" ? "Manual order" : humanize(label),
      ),
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
  return !isCalendar(renderer);
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

function replace<T>(values: T[], index: number, value: T): T[] {
  return values.map((candidate, candidateIndex) =>
    candidateIndex === index ? value : candidate,
  );
}

function nextComputedName(
  properties: EditableViewDraft["computedProperties"],
): string {
  const names = new Set(properties.map(({ name }) => name.trim()));
  let suffix = 1;
  while (names.has(suffix === 1 ? "calculated" : `calculated_${suffix}`))
    suffix += 1;
  return suffix === 1 ? "calculated" : `calculated_${suffix}`;
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
  if (value.toLocaleLowerCase() === "tasknotes_manual_order")
    return "Manual order";
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
