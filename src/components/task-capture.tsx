import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
import {
  parseTaskCapture,
  preloadTaskCapture,
  taskCapturePreview,
  type TaskCaptureResult,
} from "../domain/task-capture";
import {
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { mergeTaskCreationDefaults } from "../domain/view-creation";
import { successFeedback } from "../native/feedback";
import { DependencyEditor } from "./dependency-editor";
import { MultiValueField } from "./multi-value-field";
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

export function TaskCapture({
  configuration,
  createTask,
  completeField,
  defaults,
  placeholder = "Add a task — tomorrow 9am, #tag, +project",
  focusRequest,
  onCreated,
  onOpenCreated,
}: {
  configuration: TaskCollectionConfiguration;
  createTask(input: CreateTaskInput): Promise<Task>;
  completeField?(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  defaults?: Partial<CreateTaskInput>;
  placeholder?: string;
  focusRequest?: number;
  onCreated?(task: Task): Promise<TaskCaptureFollowUp | void>;
  onOpenCreated?(task: Task): void;
}) {
  const [text, setText] = useState("");
  const [parsedText, setParsedText] = useState("");
  const [result, setResult] = useState<TaskCaptureResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [suggestionResult, setSuggestionResult] = useState<{
    key: string;
    items: FieldCompletion[];
  }>({ key: "", items: [] });
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [pendingTitle, setPendingTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<{
    task: Task;
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const suggestionsId = useId();
  const textRef = useRef("");
  const followUpSequence = useRef(0);
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
    // Start after the first paint: collection opening stays lean, while the
    // parser is usually ready before a person begins typing.
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (focusRequest === undefined) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    const value = text.trim();
    if (!value) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void parseTaskCapture(value, configuration)
        .then((next) => {
          if (!active) return;
          const input = mergeTaskCreationDefaults(creationDefaults, next.input);
          setResult({
            input,
            preview: taskCapturePreview(input, configuration),
          });
          setParsedText(value);
        })
        .catch(() => {
          if (!active) return;
          const input = mergeTaskCreationDefaults(creationDefaults, {
            title: value,
          });
          setResult({
            input,
            preview: taskCapturePreview(input, configuration),
          });
          setParsedText(value);
        })
        .finally(() => {
          if (active) setParsing(false);
        });
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [configuration, creationDefaults, text]);

  const preview = useMemo(
    () =>
      result && parsedText === text.trim()
        ? taskCapturePreview(result.input, configuration)
        : [],
    [configuration, parsedText, result, text],
  );

  function changeText(value: string, nextCursor = value.length) {
    textRef.current = value;
    setText(value);
    setCursor(nextCursor);
    setError(null);
    if (value.trim()) {
      setParsing(true);
      return;
    }
    setResult(null);
    setParsedText("");
    setParsing(false);
    setExpanded(false);
    setError(null);
    setWarning(null);
    setFollowUp(null);
  }

  function chooseSuggestion(completion: FieldCompletion) {
    if (!activeToken) return;
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
    const value = text.trim();
    if (!value || capturing) return;
    setCapturing(true);
    setError(null);
    setWarning(null);
    let submittedTitle = "";
    try {
      const next =
        result && parsedText === value
          ? result
          : await parseTaskCapture(value, configuration)
              .then((parsed) => {
                const input = mergeTaskCreationDefaults(
                  creationDefaults,
                  parsed.input,
                );
                return {
                  input,
                  preview: taskCapturePreview(input, configuration),
                };
              })
              .catch(() => {
                const input = mergeTaskCreationDefaults(creationDefaults, {
                  title: value,
                });
                return {
                  input,
                  preview: taskCapturePreview(input, configuration),
                };
              });
      if (!next.input.title.trim())
        throw new Error("Add a title as well as task details.");
      submittedTitle = next.input.title.trim();
      setPendingTitle(submittedTitle);
      textRef.current = "";
      setText("");
      setResult(null);
      setParsedText("");
      setExpanded(false);
      setFollowUp(null);
      inputRef.current?.blur();
      const created = await createTask(next.input);
      setWarning(
        created.operationWarnings?.map(cleanTemplateWarning).join(" ") ?? null,
      );
      successFeedback();
      const sequence = followUpSequence.current + 1;
      followUpSequence.current = sequence;
      if (onCreated)
        void Promise.resolve()
          .then(() => onCreated(created))
          .then(
            (result) => {
              if (
                followUpSequence.current === sequence &&
                result?.message?.trim()
              )
                setFollowUp({ task: created, message: result.message.trim() });
            },
            () => {
              if (followUpSequence.current === sequence)
                setFollowUp({
                  task: created,
                  message:
                    "Task created. This view could not refresh, so it may not appear yet.",
                });
            },
          );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (submittedTitle && !textRef.current.trim()) {
        textRef.current = value;
        setText(value);
      }
      setError(
        submittedTitle
          ? `Could not add “${submittedTitle}”. ${message}`
          : message,
      );
    } finally {
      setPendingTitle("");
      setCapturing(false);
    }
  }

  function change(patch: Partial<CreateTaskInput>) {
    setResult((current) => {
      const input = { ...(current?.input ?? { title: text.trim() }), ...patch };
      return {
        input,
        preview: taskCapturePreview(input, configuration),
      };
    });
    setParsedText(text.trim());
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
              preview.map((item) => <span key={item.key}>{item.label}</span>)
            ) : (
              <span className="capture-plain">Plain task</span>
            )}
          </div>
          <button
            className="text-action"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Less" : "Details"}
          </button>
        </div>
      ) : null}

      {expanded && result && parsedText === text.trim() ? (
        <CaptureDetails
          configuration={configuration}
          completeField={completeField}
          input={result.input}
          onChange={change}
        />
      ) : null}

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
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

export interface TaskCaptureFollowUp {
  message?: string;
}

function CaptureDetails({
  configuration,
  completeField,
  input,
  onChange,
}: {
  configuration: TaskCollectionConfiguration;
  completeField?(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  input: CreateTaskInput;
  onChange(patch: Partial<CreateTaskInput>): void;
}) {
  return (
    <div className="capture-details">
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
          completion={configuration.fieldCompletions.tags ?? { kind: "values" }}
          completeField={completeField}
          onChange={(tags) => onChange({ tags })}
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
        <RecurrenceField
          anchor={input.recurrenceAnchor}
          scheduled={input.scheduled}
          value={input.recurrence}
          onAnchorChange={(recurrenceAnchor) => onChange({ recurrenceAnchor })}
          onChange={(recurrence) => onChange({ recurrence })}
        />
      </div>
      <DependencyEditor
        completeField={completeField ?? (async () => [])}
        dependencies={input.blockedBy ?? []}
        field={configuration.fieldMapping.blockedBy}
        onChange={(blockedBy) => onChange({ blockedBy })}
      />
      <label className="notes-field capture-notes">
        <span>Notes</span>
        <textarea
          rows={3}
          value={input.body ?? ""}
          onChange={(event) => onChange({ body: event.target.value })}
        />
      </label>
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
    </div>
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
