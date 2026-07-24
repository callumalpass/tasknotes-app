import { ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ExpressionBuilder,
  type ExpressionField,
} from "../components/expression-builder";
import {
  createViewDocument,
  emptyViewDraft,
  readViewDraft,
  removeViewFromDocument,
  updateViewDocument,
  type EditableViewDraft,
} from "../domain/view-document";
import { useRepository } from "./repository-context";

import type { TaskView, TaskViewSourceDocument } from "../domain/view";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export function ViewEditor({
  view,
  inline = false,
  onClose,
  onChanged,
}: {
  view?: TaskView;
  inline?: boolean;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const { repository } = useRepository();
  const [source, setSource] = useState<TaskViewSourceDocument | null>(null);
  const [draft, setDraft] = useState<EditableViewDraft | null>(null);
  const [configuration, setConfiguration] =
    useState<TaskCollectionConfiguration | null>(null);
  const [fields, setFields] = useState<ExpressionField[]>(defaultFields);
  const [propertyInput, setPropertyInput] = useState("");
  const [filterValid, setFilterValid] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "saving">(
    "loading",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.taskConfiguration(),
      view ? repository.readViewSource(view.source.path) : null,
      repository.syncStatus(),
    ]).then(
      ([configuration, loadedSource, sync]) => {
        if (!active) return;
        const next = loadedSource
          ? readViewDraft(loadedSource, view!.id)
          : emptyViewDraft(
              sync.mode === "replicated" ? "mdbase-cel" : "obsidian-bases",
            );
        setSource(loadedSource);
        setDraft(next);
        setConfiguration(configuration);
        setFields(viewFields(configuration, next.availableProperties));
        setStatus("ready");
      },
      (reason) => {
        if (!active) return;
        setError(message(reason));
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [repository, view]);

  const selectedFields = useMemo(
    () =>
      draft?.properties.map(
        (key) => fields.find((field) => field.key === key) ?? field(key, key),
      ) ?? [],
    [draft?.properties, fields],
  );

  async function save() {
    if (!draft || !draft.name.trim() || !filterValid) return;
    setStatus("saving");
    setError("");
    try {
      if (source) {
        await repository.updateViewSource({
          path: source.path,
          ifRevision: source.revision,
          document: updateViewDocument(source, draft),
        });
      } else {
        const format =
          draft.dialect === "obsidian-bases" ? "obsidian.base" : "mdbase.view";
        await repository.createViewSource({
          format,
          name: draft.name,
          document: createViewDocument(format, draft),
        });
      }
      await onChanged();
      onClose();
    } catch (reason) {
      setError(message(reason));
      setStatus("ready");
    }
  }

  async function remove() {
    if (!source || !view) return;
    if (!confirm(`Delete “${draft?.name ?? view.name}”?`)) return;
    setStatus("saving");
    setError("");
    try {
      const result = removeViewFromDocument(source, view.id);
      if (result.deleteSource) {
        await repository.deleteViewSource(source.path, source.revision);
      } else {
        await repository.updateViewSource({
          path: source.path,
          ifRevision: source.revision,
          document: result.document!,
        });
      }
      await onChanged();
      onClose();
    } catch (reason) {
      setError(message(reason));
      setStatus("ready");
    }
  }

  return (
    <section
      aria-labelledby="view-editor-title"
      aria-modal={inline ? undefined : true}
      className={`view-editor${inline ? " is-inline" : ""}`}
      role={inline ? "region" : "dialog"}
    >
      <header className="view-editor-header">
        {inline ? (
          <>
            <strong id="view-editor-title">View settings</strong>
            <div>
              <button className="text-action" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="save-view-action"
                disabled={
                  !draft?.name.trim() || !filterValid || status !== "ready"
                }
                type="button"
                onClick={() => void save()}
              >
                {status === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              aria-label="Close view editor"
              className="back-action"
              type="button"
              onClick={onClose}
            >
              <ChevronLeft aria-hidden="true" size={20} /> Views
            </button>
            <button
              className="save-view-action"
              disabled={
                !draft?.name.trim() || !filterValid || status !== "ready"
              }
              type="button"
              onClick={() => void save()}
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </header>
      <div className="view-editor-body">
        {!inline ? (
          <div>
            <p className="eyebrow">{view ? "Saved view" : "New saved view"}</p>
            <h1 id="view-editor-title">
              {view ? "Edit view" : "Create a view"}
            </h1>
          </div>
        ) : null}
        {error ? <p className="inline-error">{error}</p> : null}
        {!draft ? (
          <p className="view-editor-loading">Opening the view definition…</p>
        ) : (
          <>
            {!inline ? (
              <label className="view-name-field">
                <span>Name</span>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
            ) : null}

            <fieldset className="view-kind-field">
              <legend>Layout</legend>
              <div className="view-kind-options">
                {[
                  ["tasknotes.task-list", "List"],
                  ["tasknotes.kanban", "Board"],
                  ["tasknotes.calendar", "Calendar"],
                  ["tasknotes.mini-calendar", "Mini calendar"],
                ].map(([value, label]) => (
                  <button
                    aria-pressed={draft.renderer === value}
                    key={value}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        renderer: value as EditableViewDraft["renderer"],
                        ...(value === "tasknotes.kanban" && !draft.groupProperty
                          ? { groupProperty: "status" }
                          : {}),
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            {inline ? (
              <details className="inline-view-filter">
                <summary>
                  <span>
                    <strong>Filter</strong>
                    <small>Choose which tasks belong in this view</small>
                  </span>
                </summary>
                <ExpressionBuilder
                  dialect={draft.dialect}
                  fields={fields}
                  value={draft.filter}
                  onChange={(filterValue) =>
                    setDraft({ ...draft, filter: filterValue })
                  }
                  onValidityChange={setFilterValid}
                />
              </details>
            ) : (
              <section
                className="view-editor-section"
                aria-labelledby="view-filter-title"
              >
                <div>
                  <h2 id="view-filter-title">Filter</h2>
                  <p>Choose which tasks belong in this view.</p>
                </div>
                <ExpressionBuilder
                  dialect={draft.dialect}
                  fields={fields}
                  value={draft.filter}
                  onChange={(filterValue) =>
                    setDraft({ ...draft, filter: filterValue })
                  }
                  onValidityChange={setFilterValid}
                />
              </section>
            )}

            {draft.renderer !== "tasknotes.calendar" &&
            draft.renderer !== "tasknotes.mini-calendar" ? (
              <label>
                <span>
                  {draft.renderer === "tasknotes.kanban"
                    ? "Board column"
                    : "Group by"}
                </span>
                <input
                  list="view-properties"
                  placeholder={
                    draft.renderer === "tasknotes.kanban"
                      ? undefined
                      : "No grouping"
                  }
                  value={draft.groupProperty ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, groupProperty: event.target.value })
                  }
                />
              </label>
            ) : null}

            {draft.renderer === "tasknotes.calendar" ||
            draft.renderer === "tasknotes.mini-calendar" ? (
              <fieldset className="calendar-source-options">
                <legend>Calendar dates</legend>
                {[
                  ["showDue", "Due dates"],
                  ["showScheduled", "Scheduled dates"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <input
                      checked={draft.options[key] !== false}
                      type="checkbox"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          options: {
                            ...draft.options,
                            [key]: event.target.checked,
                          },
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            {draft.renderer === "tasknotes.calendar" ? (
              <>
                <label>
                  <span>Opens as</span>
                  <select
                    value={string(draft.options.calendarView) || "dayGridMonth"}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        options: {
                          ...draft.options,
                          calendarView: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="dayGridMonth">Month</option>
                    <option value="timeGridWeek">Week</option>
                    <option value="timeGridThreeDay">3 days</option>
                    <option value="timeGridDay">Day</option>
                    <option value="listWeek">Agenda</option>
                  </select>
                </label>
                <fieldset className="calendar-source-options">
                  <legend>Repeating tasks</legend>
                  {[
                    ["showRecurring", "Upcoming instances", true],
                    [
                      "showCompletedRecurringInstances",
                      "Completed instances",
                      false,
                    ],
                    [
                      "showSkippedRecurringInstances",
                      "Skipped instances",
                      false,
                    ],
                  ].map(([key, label, fallback]) => (
                    <label key={String(key)}>
                      <input
                        checked={
                          draft.options[String(key)] === undefined
                            ? Boolean(fallback)
                            : draft.options[String(key)] === true
                        }
                        type="checkbox"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            options: {
                              ...draft.options,
                              [String(key)]: event.target.checked,
                            },
                          })
                        }
                      />
                      <span>{String(label)}</span>
                    </label>
                  ))}
                </fieldset>
              </>
            ) : null}

            {configuration ? (
              <details className="view-create-defaults">
                <summary>
                  <span>
                    <strong>New tasks</strong>
                    <small>Optional defaults when adding from this view</small>
                  </span>
                </summary>
                <div className="view-create-defaults-fields">
                  <label>
                    <span>Status</span>
                    <select
                      value={string(createDefaults(draft).status)}
                      onChange={(event) =>
                        setDraft(
                          updateCreateDefault(
                            draft,
                            "status",
                            event.target.value || undefined,
                          ),
                        )
                      }
                    >
                      <option value="">From the task form</option>
                      {configuration.statuses.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={string(createDefaults(draft).priority)}
                      onChange={(event) =>
                        setDraft(
                          updateCreateDefault(
                            draft,
                            "priority",
                            event.target.value || undefined,
                          ),
                        )
                      }
                    >
                      <option value="">From the task form</option>
                      {configuration.priorities.map((priority) => (
                        <option key={priority.value} value={priority.value}>
                          {priority.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(
                    [
                      ["projects", "Projects"],
                      ["contexts", "Contexts"],
                      ["tags", "Tags"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        placeholder="Comma separated"
                        value={stringList(createDefaults(draft)[key]).join(
                          ", ",
                        )}
                        onChange={(event) =>
                          setDraft(
                            updateCreateDefault(
                              draft,
                              key,
                              commaList(event.target.value),
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <p>
                  TaskNotes also fills simple “is” and “contains” filters when
                  it can do so safely.
                </p>
              </details>
            ) : null}

            <section
              className="view-editor-section"
              aria-labelledby="view-properties-title"
            >
              <div>
                <h2 id="view-properties-title">Displayed properties</h2>
                <p>These appear below each task in this order.</p>
              </div>
              <div className="selected-view-properties">
                {selectedFields.map((selected, index) => (
                  <div key={`${selected.key}:${index}`}>
                    <span>
                      <strong>{selected.label}</strong>
                      <small>{selected.key}</small>
                    </span>
                    <button
                      aria-label={`Move ${selected.label} up`}
                      disabled={index === 0}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          properties: move(draft.properties, index, index - 1),
                        })
                      }
                    >
                      <ArrowUp aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label={`Move ${selected.label} down`}
                      disabled={index === selectedFields.length - 1}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          properties: move(draft.properties, index, index + 1),
                        })
                      }
                    >
                      <ArrowDown aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label={`Remove ${selected.label}`}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          properties: draft.properties.filter(
                            (_, candidate) => candidate !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="add-view-property">
                <input
                  aria-label="Property to display"
                  list="view-properties"
                  placeholder="Add a property"
                  value={propertyInput}
                  onChange={(event) => setPropertyInput(event.target.value)}
                />
                <button
                  disabled={
                    !propertyInput.trim() ||
                    draft.properties.includes(propertyInput.trim())
                  }
                  type="button"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      properties: [...draft.properties, propertyInput.trim()],
                    });
                    setPropertyInput("");
                  }}
                >
                  <Plus aria-hidden="true" size={16} /> Add
                </button>
              </div>
              <datalist id="view-properties">
                {fields.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </datalist>
            </section>

            {view && !inline ? (
              <button
                className="danger-text-action"
                type="button"
                onClick={() => void remove()}
              >
                Delete view
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
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

function move<T>(values: T[], from: number, to: number): T[] {
  const next = [...values];
  const [value] = next.splice(from, 1);
  next.splice(to, 0, value);
  return next;
}

function createDefaults(draft: EditableViewDraft): Record<string, unknown> {
  return record(record(draft.options.create).defaults);
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

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function humanize(value: string): string {
  const name = value.includes(".") ? value.split(".").at(-1)! : value;
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
