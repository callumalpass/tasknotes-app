import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  activeCaptureToken,
  applyCaptureSuggestion,
  captureSuggestionRequest,
  captureTriggers,
  configuredCaptureSuggestions,
} from "../domain/capture-autosuggest";
import { preloadTaskCapture, taskCapturePreview } from "../domain/task-capture";
import {
  CaptureSession,
  type CaptureFollowUp as TaskCaptureFollowUp,
} from "../application/capture-session";
export type { CaptureFollowUp as TaskCaptureFollowUp } from "../application/capture-session";
import {
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { successFeedback } from "../native/feedback";
import { DependencyEditor } from "./dependency-editor";
import { MultiValueField } from "./multi-value-field";
import { OperationErrorNotice } from "./operation-error-notice";
import { RecurrenceField } from "./recurrence-field";
import {
  TaskNotesDateTimeField,
  TaskNotesSelectField,
} from "./tasknotes-controls";

import type { CreateTaskInput, Task } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";

const emptyDefaults: Partial<CreateTaskInput> = {};
type CaptureDetailSection = "timing" | "organize" | "repeat" | "notes";

export function TaskCapture({
  configuration,
  createTask,
  completeField,
  defaults,
  placeholder = "Add a task — tomorrow 9am, #tag, +project",
  showGuide = false,
  retainFocusAfterCreate = false,
  focusRequest,
  onCreated,
  onOpenCreated,
  session: providedSession,
  onAccepted,
}: {
  configuration: TaskCollectionConfiguration;
  createTask(input: CreateTaskInput): Promise<Task>;
  completeField?(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  defaults?: Partial<CreateTaskInput>;
  placeholder?: string;
  showGuide?: boolean;
  retainFocusAfterCreate?: boolean;
  focusRequest?: number;
  onCreated?(task: Task): Promise<TaskCaptureFollowUp | void>;
  onOpenCreated?(task: Task): void;
  session?: CaptureSession;
  onAccepted?(task: Task, version: number): void;
}) {
  const [localSession] = useState(() => new CaptureSession());
  const session = providedSession ?? localSession;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { text, parsedText, result, parsing, pendingTitle, error, accepted } =
    snapshot;
  const capturing = snapshot.status === "submitting";
  const warning = accepted?.task.operationWarnings
    ?.map(cleanTemplateWarning)
    .join(" ");
  const followUp = accepted?.followUp
    ? { task: accepted.task, message: accepted.followUp }
    : null;
  const [expanded, setExpanded] = useState(false);
  const [detailSections, setDetailSections] = useState<
    Record<CaptureDetailSection, boolean>
  >({ timing: true, organize: false, repeat: false, notes: false });
  const [cursor, setCursor] = useState(0);
  const [suggestionResult, setSuggestionResult] = useState<{
    key: string;
    items: FieldCompletion[];
  }>({ key: "", items: [] });
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const suggestionsId = useId();
  const creationDefaults = defaults ?? emptyDefaults;
  const triggers = useMemo(
    () => captureTriggers(configuration),
    [configuration],
  );
  const activeToken = useMemo(
    () => activeCaptureToken(text, cursor, triggers),
    [cursor, text, triggers],
  );
  const suggestionRequest = useMemo(
    () =>
      activeToken
        ? captureSuggestionRequest(activeToken, configuration)
        : undefined,
    [activeToken, configuration],
  );
  const suggestionKey = suggestionRequest
    ? [
        suggestionRequest.field,
        suggestionRequest.kind,
        suggestionRequest.query ?? "",
        activeToken?.start ?? 0,
      ].join("\0")
    : "";
  const suggestions =
    suggestionKey && suggestionResult.key === suggestionKey
      ? suggestionResult.items
      : [];

  useEffect(() => {
    if (!suggestionRequest || !suggestionKey) return;
    let active = true;
    const fallback = configuredCaptureSuggestions(suggestionRequest);
    const completion = completeField
      ? completeField(suggestionRequest)
      : Promise.resolve(fallback);
    void completion.then(
      (next) => {
        if (!active) return;
        setSuggestionResult({
          key: suggestionKey,
          items: next.length ? next : fallback,
        });
        setSelectedSuggestion(0);
      },
      () => {
        if (!active) return;
        setSuggestionResult({ key: suggestionKey, items: fallback });
        setSelectedSuggestion(0);
      },
    );
    return () => {
      active = false;
    };
  }, [completeField, suggestionKey, suggestionRequest]);

  useEffect(() => {
    if (!text.trim()) return;
    preloadTaskCapture();
  }, [text]);

  useEffect(() => {
    if (focusRequest === undefined) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    if (!text.trim()) return;
    const timeout = window.setTimeout(
      () => void session.parse(configuration, creationDefaults),
      80,
    );
    return () => window.clearTimeout(timeout);
  }, [session, configuration, creationDefaults, text]);

  const preview = useMemo(
    () =>
      result && parsedText === text.trim()
        ? taskCapturePreview(result.input, configuration)
        : [],
    [configuration, parsedText, result, text],
  );

  function changeText(value: string, nextCursor = value.length) {
    session.editText(value);
    setCursor(nextCursor);
    if (!value.trim()) setExpanded(false);
  }

  function chooseSuggestion(completion: FieldCompletion) {
    if (capturing || !activeToken) return;
    const next = applyCaptureSuggestion(text, activeToken, completion.value);
    changeText(next.text, next.cursor);
    setSuggestionResult({ key: "", items: [] });
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function handleCaptureKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedSuggestion((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedSuggestion(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      chooseSuggestion(suggestions[selectedSuggestion]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionResult({ key: "", items: [] });
    }
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    if (session.getSnapshot().status === "submitting") return;
    await session.submit({
      configuration,
      defaults: creationDefaults,
      create: createTask,
      refresh: onCreated,
      onAccepted: (task, version) => {
        setExpanded(false);
        successFeedback();
        onAccepted?.(task, version);
        if (retainFocusAfterCreate)
          requestAnimationFrame(() =>
            inputRef.current?.focus({ preventScroll: true }),
          );
      },
    });
  }

  function change(patch: Partial<CreateTaskInput>) {
    session.editFields(patch, configuration);
  }

  return (
    <form
      className="capture-composer"
      aria-busy={capturing}
      onSubmit={(event) => void capture(event)}
    >
      <div className="quick-capture">
        <span aria-hidden="true" className="capture-plus">
          +
        </span>
        <label className="visually-hidden" htmlFor={inputId}>
          New task title
        </label>
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-activedescendant={
            suggestions.length
              ? `${suggestionsId}-option-${selectedSuggestion}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={suggestionsId}
          aria-expanded={suggestions.length > 0}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          value={text}
          readOnly={capturing}
          onChange={(event) =>
            changeText(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            )
          }
          onClick={(event) =>
            setCursor(event.currentTarget.selectionStart ?? text.length)
          }
          onFocus={preloadTaskCapture}
          onKeyDown={handleCaptureKeyDown}
          onKeyUp={(event) =>
            setCursor(event.currentTarget.selectionStart ?? text.length)
          }
        />
        {text.trim() ? (
          <button disabled={capturing} type="submit">
            {capturing ? "Adding" : "Add"}
          </button>
        ) : null}
      </div>

      {showGuide && !text.trim() ? (
        <p className="capture-guide">
          Add dates and tags naturally — try “Call Sam tomorrow 9am #work”.
        </p>
      ) : null}

      {suggestions.length ? (
        <div
          id={suggestionsId}
          className="capture-suggestions"
          role="listbox"
          aria-label="Task field suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <button
              id={`${suggestionsId}-option-${index}`}
              className={index === selectedSuggestion ? "is-selected" : ""}
              key={`${suggestion.kind}:${suggestion.value}`}
              role="option"
              aria-selected={index === selectedSuggestion}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSuggestion(suggestion)}
            >
              <span>{suggestion.label}</span>
              {suggestion.detail ? <small>{suggestion.detail}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      {text.trim() ? (
        <div className="capture-interpretation" aria-live="polite">
          <div>
            {parsing && parsedText !== text.trim() ? (
              <span className="capture-parsing">Understanding…</span>
            ) : preview.length ? (
              preview.map((item) =>
                item.key === "scheduled" || item.key === "due" ? (
                  <span className="capture-date-token" key={item.key}>
                    <button
                      type="button"
                      disabled={capturing}
                      aria-label={`Edit ${item.key}`}
                      onClick={() => {
                        setExpanded(true);
                        setDetailSections((current) => ({
                          ...current,
                          timing: true,
                        }));
                      }}
                    >
                      {item.key === "scheduled" ? "Scheduled " : ""}
                      {item.label}
                    </button>
                    <button
                      type="button"
                      disabled={capturing}
                      aria-label={`Remove ${item.key}`}
                      onClick={() => change({ [item.key]: undefined })}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span key={item.key}>{item.label}</span>
                ),
              )
            ) : null}
          </div>
          <button
            className="text-action"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide details" : "Add details"}
          </button>
        </div>
      ) : null}

      {result &&
      parsedText === text.trim() &&
      result.input.title !== text.trim() ? (
        <p className="capture-title-preview">Task: {result.input.title}</p>
      ) : null}
      {expanded && result && parsedText === text.trim() ? (
        <CaptureDetails
          configuration={configuration}
          completeField={completeField}
          openSections={detailSections}
          input={result.input}
          onChange={change}
          onToggleSection={(section, open) =>
            setDetailSections((current) => ({ ...current, [section]: open }))
          }
        />
      ) : null}

      {error ? (
        <OperationErrorNotice
          action="The task"
          message={error}
          recovery="Your draft is still here. Check it and try again."
        />
      ) : null}
      {pendingTitle ? (
        <p className="capture-pending" role="status">
          Adding “{pendingTitle}”…
        </p>
      ) : null}
      {warning ? (
        <p className="capture-warning" role="status">
          {warning}
        </p>
      ) : null}
      {followUp ? (
        <div className="capture-follow-up" role="status">
          <span>{followUp.message}</span>
          {onOpenCreated ? (
            <button
              className="text-action"
              type="button"
              onClick={() => onOpenCreated(followUp.task)}
            >
              Open task
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function CaptureDetails({
  configuration,
  completeField,
  input,
  openSections,
  onChange,
  onToggleSection,
}: {
  configuration: TaskCollectionConfiguration;
  completeField?(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  input: CreateTaskInput;
  openSections: Record<CaptureDetailSection, boolean>;
  onChange(patch: Partial<CreateTaskInput>): void;
  onToggleSection(section: CaptureDetailSection, open: boolean): void;
}) {
  return (
    <div className="capture-details">
      <CaptureDetailGroup
        description="Dates and estimate"
        label="Timing"
        open={openSections.timing}
        onToggle={(open) => onToggleSection("timing", open)}
      >
        <div className="capture-details-grid">
          <CaptureDateTime
            label="Scheduled"
            value={input.scheduled}
            onChange={(scheduled) => onChange({ scheduled })}
          />
          <CaptureDateTime
            label="Due"
            value={input.due}
            onChange={(due) => onChange({ due })}
          />
          <label className="form-field">
            <span>Estimate (minutes)</span>
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={input.timeEstimate ?? ""}
              onChange={(event) =>
                onChange({
                  timeEstimate: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
        </div>
      </CaptureDetailGroup>
      <CaptureDetailGroup
        description="Status, priority, and relationships"
        label="Organize"
        open={openSections.organize}
        onToggle={(open) => onToggleSection("organize", open)}
      >
        <div className="capture-details-grid">
          <TaskNotesSelectField
            label="Status"
            options={configuration.statuses}
            value={input.status ?? configuration.defaults.status}
            onChange={(status) => onChange({ status })}
          />
          <TaskNotesSelectField
            label="Priority"
            options={configuration.priorities}
            value={input.priority ?? configuration.defaults.priority}
            onChange={(priority) => onChange({ priority })}
          />
          <CaptureList
            field={configuration.fieldMapping.projects}
            label="Projects"
            value={input.projects}
            completion={
              configuration.fieldCompletions[
                configuration.fieldMapping.projects
              ] ?? { kind: "records" }
            }
            completeField={completeField}
            onChange={(projects) => onChange({ projects })}
          />
          <CaptureList
            field={configuration.fieldMapping.contexts}
            label="Contexts"
            value={input.contexts}
            completion={
              configuration.fieldCompletions[
                configuration.fieldMapping.contexts
              ] ?? { kind: "values" }
            }
            completeField={completeField}
            onChange={(contexts) => onChange({ contexts })}
          />
          <CaptureList
            field="tags"
            label="Tags"
            value={input.tags}
            completion={
              configuration.fieldCompletions.tags ?? { kind: "values" }
            }
            completeField={completeField}
            onChange={(tags) => onChange({ tags })}
          />
        </div>
        <DependencyEditor
          completeField={completeField ?? (async () => [])}
          dependencies={input.blockedBy ?? []}
          field={configuration.fieldMapping.blockedBy}
          onChange={(blockedBy) => onChange({ blockedBy })}
        />
      </CaptureDetailGroup>
      <CaptureDetailGroup
        description="Recurrence and template"
        label="Repeat"
        open={openSections.repeat}
        onToggle={(open) => onToggleSection("repeat", open)}
      >
        <RecurrenceField
          anchor={input.recurrenceAnchor}
          scheduled={input.scheduled}
          value={input.recurrence}
          onAnchorChange={(recurrenceAnchor) => onChange({ recurrenceAnchor })}
          onChange={(recurrence) => onChange({ recurrence })}
        />
        {configuration.templating.enabled ? (
          <label className="capture-template-choice">
            <input
              checked={input.useTemplate !== false}
              type="checkbox"
              onChange={(event) =>
                onChange({ useTemplate: event.target.checked })
              }
            />
            <span>
              Use template
              {configuration.templating.templatePath
                ? ` · ${configuration.templating.templatePath}`
                : ""}
            </span>
          </label>
        ) : null}
      </CaptureDetailGroup>
      <CaptureDetailGroup
        description="Extra context for the task"
        label="Notes"
        open={openSections.notes}
        onToggle={(open) => onToggleSection("notes", open)}
      >
        <label className="notes-field capture-notes">
          <span className="visually-hidden">Notes</span>
          <textarea
            aria-label="Notes"
            placeholder="Add notes"
            rows={3}
            value={input.body ?? ""}
            onChange={(event) => onChange({ body: event.target.value })}
          />
        </label>
      </CaptureDetailGroup>
    </div>
  );
}

function CaptureDetailGroup({
  children,
  description,
  label,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  description: string;
  label: string;
  open: boolean;
  onToggle(open: boolean): void;
}) {
  return (
    <details
      className="capture-details-section"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </summary>
      <div className="capture-details-section-content">{children}</div>
    </details>
  );
}

function cleanTemplateWarning(value: string): string {
  return value
    .replace(/^template_missing:\s*/i, "Template unavailable. ")
    .replace(/^template_parse_failed:\s*/i, "Template could not be read. ");
}

function CaptureDateTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange(value?: string): void;
}) {
  return (
    <TaskNotesDateTimeField
      combineValue={combineTaskDateTime}
      label={label}
      splitValue={(current) => ({
        date: taskDatePart(current) || undefined,
        time: taskTimePart(current) || undefined,
      })}
      value={value}
      onChange={onChange}
    />
  );
}

function CaptureList({
  field,
  label,
  value = [],
  completion,
  completeField,
  onChange,
}: {
  field: string;
  label: string;
  value?: string[];
  completion: import("../domain/task-configuration").TaskFieldCompletionConfiguration;
  completeField?(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(value: string[]): void;
}) {
  if (completeField)
    return (
      <MultiValueField
        completion={completion}
        completeField={completeField}
        field={field}
        label={label}
        placeholder={`Add ${label.toLocaleLowerCase()}`}
        values={value}
        onChange={onChange}
      />
    );
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        value={value.join(", ")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}
