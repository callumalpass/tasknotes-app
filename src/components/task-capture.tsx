import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  parseTaskCapture,
  preloadTaskCapture,
  taskCapturePreview,
  type TaskCaptureResult,
} from "../domain/task-capture";
import {
  combineTaskDateTime,
  recurrencePreset,
  recurrenceRule,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { mergeTaskCreationDefaults } from "../domain/view-creation";
import { successFeedback } from "../native/feedback";
import { MultiValueField } from "./multi-value-field";
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
  const textRef = useRef("");
  const followUpSequence = useRef(0);
  const creationDefaults = defaults ?? emptyDefaults;

  useEffect(() => {
    // Start after the first paint: collection opening stays lean, while the
    // parser is usually ready before a person begins typing.
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (focusRequest === undefined) return;
    inputRef.current?.focus();
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
          setError(null);
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

  function changeText(value: string) {
    textRef.current = value;
    setText(value);
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
        <label className="visually-hidden" htmlFor="quick-task">
          New task title
        </label>
        <input
          id="quick-task"
          ref={inputRef}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          value={text}
          onChange={(event) => changeText(event.target.value)}
          onFocus={preloadTaskCapture}
        />
        {text.trim() ? (
          <button disabled={capturing} type="submit">
            {capturing ? "Adding" : "Add"}
          </button>
        ) : null}
      </div>

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
        <TaskNotesSelectField
          label="Repeat"
          options={[
            { value: "never", label: "Never" },
            { value: "daily", label: "Daily" },
            { value: "weekdays", label: "Weekdays" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
            ...(recurrencePreset(input.recurrence) === "custom"
              ? [{ value: "custom", label: "Custom rule" }]
              : []),
          ]}
          value={recurrencePreset(input.recurrence)}
          onChange={(value) =>
            onChange({
              recurrence:
                value === "never"
                  ? undefined
                  : (recurrenceRule(value) ?? input.recurrence),
            })
          }
        />
      </div>
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
