import { countLabel, builtInFieldLabel } from "../i18n/default-labels";
import { appLocale } from "../i18n/app";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
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
import {
  field,
  fieldOptions,
  humanize,
  viewFields,
} from "./view-editor-fields";

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
  const { t } = useLingui();
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
        description={t({ message: "Choose which tasks belong in this view." })}
        id="view-filter"
        open={openSection === "view-filter"}
        summary={
          draft.filter
            ? t({ message: "Custom filter" })
            : t({ message: "All tasks" })
        }
        title={t({ message: "Filter" })}
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
        description={t({
          message: "Choose how tasks are grouped and ordered.",
        })}
        id="view-group-sort"
        open={openSection === "view-group-sort"}
        summary={groupSortSummary(draft)}
        title={t({ message: "Group & sort" })}
        onOpenChange={(open) => setOpenSection(open ? "view-group-sort" : null)}
      >
        <div className="view-editor-grid">
          {supportsGrouping(draft.renderer) ? (
            <>
              <div className="view-editor-control-field">
                <span>
                  {draft.renderer === "tasknotes.kanban"
                    ? t({ message: "Board column" })
                    : t({ message: "Group by" })}
                </span>
                <TaskNotesCombobox
                  ariaLabel={
                    draft.renderer === "tasknotes.kanban"
                      ? t({ message: "Board column" })
                      : t({ message: "Group by" })
                  }
                  options={fieldOptions(fields)}
                  placeholder={
                    draft.renderer === "tasknotes.kanban"
                      ? t({ message: "Choose a property" })
                      : t({ message: "No grouping" })
                  }
                  value={draft.groupProperty ?? ""}
                  onChange={(groupProperty) =>
                    patch({ groupProperty: groupProperty || undefined })
                  }
                />
              </div>
              <div className="view-editor-control-field">
                <span>
                  <Trans>Group direction</Trans>
                </span>
                <TaskNotesSelect
                  ariaLabel={t({ message: "Group direction" })}
                  disabled={!draft.groupProperty}
                  options={[
                    { value: "asc", label: t({ message: "Ascending" }) },
                    { value: "desc", label: t({ message: "Descending" }) },
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
              <h3>
                <Trans>Sort</Trans>
              </h3>
              <p>
                <Trans>Earlier rules take priority.</Trans>
              </p>
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
                ? t({
                    message:
                      "Manual order is active. Drag handles will appear on tasks.",
                  })
                : t({
                    message:
                      "Move Manual order to the first position to enable drag handles.",
                  })}
            </p>
          ) : null}
          <div className="add-view-property">
            <TaskNotesCombobox
              ariaLabel={t({ message: "Property to sort" })}
              options={fieldOptions(filterAndSortFields)}
              placeholder={t({ message: "Add a sort rule" })}
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
              <Plus aria-hidden="true" size={16} /> <Trans>Add</Trans>
            </button>
          </div>
        </div>
      </EditorSection>

      <EditorSection
        description={t({
          message: "Choose the information shown beneath each task.",
        })}
        id="view-fields"
        open={openSection === "view-fields"}
        summary={fieldsSummary(draft)}
        title={t({ message: "Fields shown" })}
        onOpenChange={(open) => setOpenSection(open ? "view-fields" : null)}
      >
        <div className="view-editor-subsection view-editor-subsection-first">
          <div className="view-editor-subsection-heading">
            <div>
              <h3>
                <Trans>Displayed properties</Trans>
              </h3>
              <p>
                <Trans>Shown in this order below each item.</Trans>
              </p>
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
              ariaLabel={t({ message: "Property to display" })}
              options={fieldOptions(fields)}
              placeholder={t({ message: "Add a property" })}
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
              <Plus aria-hidden="true" size={16} /> <Trans>Add</Trans>
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
  const { t } = useLingui();
  const noun = draft.dialect === "obsidian-bases" ? "formula" : "projection";

  return (
    <EditorSection
      description={t({
        message: "Formulas and source details for this saved view.",
      })}
      id="view-advanced"
      open={open}
      summary={[
        draft.computedProperties.length
          ? countLabel(draft.computedProperties.length, noun)
          : noun === "formula"
            ? t`No formulas`
            : t`No projections`,
        sourcePath ? t`Source file` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      title={t({ message: "Advanced" })}
      onOpenChange={onOpenChange}
    >
      <div className="view-editor-subsection-heading">
        <div>
          <h3>
            {draft.dialect === "obsidian-bases"
              ? t({ message: "Formulas" })
              : t({ message: "Projections" })}
          </h3>
          <p>
            {draft.dialect === "obsidian-bases"
              ? t({
                  message:
                    "Reusable values for filters, grouping, sorting, and fields.",
                })
              : t({
                  message: "Reusable values for grouping and displayed fields.",
                })}
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
                  <span>
                    <Trans>Name</Trans>
                  </span>
                  <input
                    aria-label={t`Computed property name ${index + 1}`}
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
                    <span>
                      <Trans>Available in</Trans>
                    </span>
                    <TaskNotesSelect
                      ariaLabel={t`Computed property scope ${index + 1}`}
                      options={[
                        { value: "view", label: t({ message: "This view" }) },
                        {
                          value: "source",
                          label: t({ message: "Every view in this file" }),
                        },
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
                  <span>
                    <Trans>Expression</Trans>
                  </span>
                  <textarea
                    aria-label={t`Computed property expression ${index + 1}`}
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
                    aria-label={t`Remove computed property ${property.name || index + 1}`}
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
        <p className="view-editor-empty-row">
          <Trans>No computed properties.</Trans>
        </p>
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
          <Plus aria-hidden="true" size={15} /> <Trans>Add </Trans>
          {noun}
        </button>
        {draft.dialect === "obsidian-bases" ? (
          <small>
            <Trans>
              These formulas are shared by views in the same source file.
            </Trans>
          </small>
        ) : null}
      </div>
      <p
        className={error ? "expression-status is-error" : "expression-status"}
        role={error ? "alert" : undefined}
      >
        {error ||
          (draft.computedProperties.length
            ? t({ message: "Computed properties are valid" })
            : "")}
      </p>
      {sourcePath ? (
        <div className="view-source-details">
          <span>
            <Trans>Source file</Trans>
          </span>
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
  const { t } = useLingui();
  const [layoutOpen, setLayoutOpen] = useState(
    () => !window.matchMedia?.("(max-width: 839px)").matches,
  );
  const layoutLabel =
    layouts.find((layout) => layout.value === draft.renderer)?.label ??
    draft.renderer;
  return (
    <section className="view-identity" aria-labelledby="view-identity-title">
      <div className="view-identity-heading">
        <h2 id="view-identity-title">
          <Trans>View details</Trans>
        </h2>
        <p>
          <Trans>Name this view and choose its layout.</Trans>
        </p>
      </div>
      <label className="view-name-field">
        <span>
          <Trans>View name</Trans>
        </span>
        <input
          aria-label={t({ message: "View name" })}
          autoFocus={autoFocusName}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <details
        className="view-layout-disclosure"
        open={layoutOpen}
        onToggle={(event) => setLayoutOpen(event.currentTarget.open)}
      >
        <summary>
          <Trans>
            Layout: {layoutLabel}
            {draft.renderer === "tasknotes.planner"
              ? t({ message: " (external app)" })
              : ""}
          </Trans>
        </summary>
        <fieldset className="view-kind-field">
          <legend className="visually-hidden">
            <Trans>Layout</Trans>
          </legend>
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
      </details>
      {draft.renderer === "tasknotes.planner" ? (
        <p className="view-planner-explanation">
          <Trans>
            Planner is a separate app. Save this view, then choose Open in
            Planner.
          </Trans>
        </p>
      ) : null}
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
  const { t } = useLingui();
  function option(key: string, value: unknown) {
    onChange({
      ...draft,
      options: { ...draft.options, [key]: value },
    });
  }

  return (
    <EditorSection
      description={t({
        message: "Choose the calendar mode and which task dates become events.",
      })}
      id="view-calendar"
      open={open}
      summary={calendarSummary(draft)}
      title={t({ message: "Calendar" })}
      onOpenChange={onOpenChange}
    >
      {draft.renderer === "tasknotes.calendar" ? (
        <div className="view-editor-control-field">
          <span>
            <Trans>Opens as</Trans>
          </span>
          <TaskNotesSelect
            ariaLabel={t({ message: "Opens as" })}
            options={[
              { value: "dayGridMonth", label: t({ message: "Month" }) },
              { value: "timeGridWeek", label: t({ message: "Week" }) },
              { value: "timeGridThreeDay", label: t({ message: "3 days" }) },
              { value: "timeGridDay", label: t({ message: "Day" }) },
              { value: "listWeek", label: t({ message: "Agenda" }) },
            ]}
            value={string(draft.options.calendarView) || "dayGridMonth"}
            onChange={(calendarView) => option("calendarView", calendarView)}
          />
        </div>
      ) : null}

      <div className="view-toggle-list">
        <ViewToggle
          checked={draft.options.showScheduled !== false}
          description={t({ message: "Use the configured scheduled field." })}
          label={t({ message: "Scheduled dates" })}
          onChange={(checked) => option("showScheduled", checked)}
        />
        <ViewToggle
          checked={draft.options.showDue !== false}
          description={t({ message: "Use the configured due field." })}
          label={t({ message: "Due dates" })}
          onChange={(checked) => option("showDue", checked)}
        />
        {draft.renderer === "tasknotes.calendar" ? (
          <>
            <ViewToggle
              checked={draft.options.showRecurring !== false}
              description={t({ message: "Show future virtual occurrences." })}
              label={t({ message: "Upcoming recurring instances" })}
              onChange={(checked) => option("showRecurring", checked)}
            />
            <ViewToggle
              checked={draft.options.showCompletedRecurringInstances === true}
              description={t({ message: "Include completed occurrences." })}
              label={t({ message: "Completed recurring instances" })}
              onChange={(checked) =>
                option("showCompletedRecurringInstances", checked)
              }
            />
            <ViewToggle
              checked={draft.options.showSkippedRecurringInstances === true}
              description={t({ message: "Include skipped occurrences." })}
              label={t({ message: "Skipped recurring instances" })}
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
  const { t } = useLingui();
  const enabled = draft.options.create !== false;
  const defaults = createDefaults(draft);

  return (
    <EditorSection
      description={t({
        message: "Set what happens when a task is added from this view.",
      })}
      id="view-new-tasks"
      open={open}
      summary={newTaskSummary(enabled, defaults)}
      title={t({ message: "New tasks" })}
      onOpenChange={onOpenChange}
    >
      <ViewToggle
        checked={enabled}
        description={t({ message: "Keep the quick-add field on this view." })}
        label={t({ message: "Allow task creation" })}
        onChange={(checked) => onChange(updateCreateEnabled(draft, checked))}
      />
      {enabled ? (
        <div className="view-create-defaults-fields">
          <div className="view-editor-control-field">
            <span>
              <Trans>Status</Trans>
            </span>
            <TaskNotesSelect
              ariaLabel={t({ message: "Default status" })}
              options={[
                { value: "", label: t({ message: "From the task form" }) },
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
            <span>
              <Trans>Priority</Trans>
            </span>
            <TaskNotesSelect
              ariaLabel={t({ message: "Default priority" })}
              options={[
                { value: "", label: t({ message: "From the task form" }) },
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
                t({ message: "Projects" }),
                configuration.fieldMapping.projects,
                t({ message: "Add a project" }),
              ],
              [
                "contexts",
                t({ message: "Contexts" }),
                configuration.fieldMapping.contexts,
                t({ message: "Add a context" }),
              ],
              [
                "tags",
                t({ message: "Tags" }),
                "tags",
                t({ message: "Add a tag" }),
              ],
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
            <Trans>
              Defaults inferred from simple filter conditions are added when the
              task is created.
            </Trans>
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
  const { t } = useLingui();
  if (!rules.length)
    return (
      <p className="view-editor-empty-row">
        <Trans>Collection order is used.</Trans>
      </p>
    );
  return (
    <div className="view-sort-rules">
      {rules.map((rule, index) => (
        <div key={`${rule.property}:${index}`}>
          <TaskNotesCombobox
            ariaLabel={t`Sort property ${index + 1}`}
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
            ariaLabel={t`Sort direction ${index + 1}`}
            options={[
              { value: "asc", label: t({ message: "Ascending" }) },
              { value: "desc", label: t({ message: "Descending" }) },
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
      <p className="view-editor-empty-row">
        <Trans>Only the task title is shown.</Trans>
      </p>
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
  const { t } = useLingui();
  return (
    <div className="view-order-actions">
      <button
        aria-label={t`Move ${label} up`}
        disabled={index === 0}
        type="button"
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp aria-hidden="true" size={15} />
      </button>
      <button
        aria-label={t`Move ${label} down`}
        disabled={index === count - 1}
        type="button"
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown aria-hidden="true" size={15} />
      </button>
      <button aria-label={t`Remove ${label}`} type="button" onClick={onRemove}>
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
    get label() {
      return t({ message: "List" });
    },
    get description() {
      return t({ message: "Compact rows" });
    },
    icon: List,
  },
  {
    value: "tasknotes.kanban",
    get label() {
      return t({ message: "Board" });
    },
    get description() {
      return t({ message: "Grouped columns" });
    },
    icon: Columns3,
  },
  {
    value: "tasknotes.calendar",
    get label() {
      return t({ message: "Calendar" });
    },
    get description() {
      return t({ message: "Full schedule" });
    },
    icon: CalendarDays,
  },
  {
    value: "tasknotes.mini-calendar",
    get label() {
      return t({ message: "Mini calendar" });
    },
    get description() {
      return t({ message: "Date and agenda" });
    },
    icon: CalendarRange,
  },
  {
    value: "tasknotes.planner",
    get label() {
      return t({ message: "Planner" });
    },
    get description() {
      return t({ message: "External app" });
    },
    icon: ChartNoAxesGantt,
  },
];

function groupSortSummary(draft: EditableViewDraft): string {
  const parts = [
    draft.groupProperty ? t`Grouped by ${humanize(draft.groupProperty)}` : "",
    draft.sort.length
      ? countLabel(draft.sort.length, "sort")
      : t({ message: "Collection order" }),
  ].filter(Boolean);
  return parts.join(" · ");
}

function fieldsSummary(draft: EditableViewDraft): string {
  return draft.properties.length
    ? countLabel(draft.properties.length, "field")
    : t({ message: "Title only" });
}

function calendarSummary(draft: EditableViewDraft): string {
  const dates = [
    draft.options.showDue !== false ? t`due` : "",
    draft.options.showScheduled !== false ? t`scheduled` : "",
  ].filter(Boolean);
  const mode =
    draft.renderer === "tasknotes.calendar"
      ? calendarModeLabel(string(draft.options.calendarView))
      : t({ message: "Mini calendar" });
  return dates.length
    ? `${mode} · ${new Intl.ListFormat(appLocale(), { style: "long", type: "conjunction" }).format(dates)}`
    : mode;
}

function calendarModeLabel(value: string): string {
  return (
    {
      dayGridMonth: t`Month`,
      timeGridWeek: t`Week`,
      timeGridThreeDay: t`3 days`,
      timeGridDay: t`Day`,
      listWeek: t`Agenda`,
    }[value || "dayGridMonth"] ?? t({ message: "Month" })
  );
}

function newTaskSummary(
  enabled: boolean,
  defaults: Record<string, unknown>,
): string {
  if (!enabled) return t({ message: "Task creation off" });
  const count = Object.keys(defaults).length;
  return count
    ? countLabel(count, "default")
    : t({ message: "Task creation on" });
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
