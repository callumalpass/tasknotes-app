import { useEffect, useMemo, useState, type FormEvent } from "react";

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

import type { CreateTaskInput } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export function TaskCapture({
  configuration,
  createTask,
}: {
  configuration: TaskCollectionConfiguration;
  createTask(input: CreateTaskInput): Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [parsedText, setParsedText] = useState("");
  const [result, setResult] = useState<TaskCaptureResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Start after the first paint: collection opening stays lean, while the
    // parser is usually ready before a person begins typing.
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const value = text.trim();
    if (!value) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void parseTaskCapture(value, configuration)
        .then((next) => {
          if (!active) return;
          setResult(next);
          setParsedText(value);
          setError(null);
        })
        .catch(() => {
          if (!active) return;
          setResult({ input: { title: value }, preview: [] });
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
  }, [configuration, text]);

  const preview = useMemo(
    () =>
      result && parsedText === text.trim()
        ? taskCapturePreview(result.input, configuration)
        : [],
    [configuration, parsedText, result, text],
  );

  function changeText(value: string) {
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
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const next =
        result && parsedText === value
          ? result
          : await parseTaskCapture(value, configuration).catch(() => ({
              input: { title: value },
              preview: [],
            }));
      if (!next.input.title.trim())
        throw new Error("Add a title as well as task details.");
      await createTask(next.input);
      setText("");
      setResult(null);
      setParsedText("");
      setExpanded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
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
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add a task — tomorrow 9am, #tag, +project"
          value={text}
          onChange={(event) => changeText(event.target.value)}
          onFocus={preloadTaskCapture}
        />
        {text.trim() ? (
          <button disabled={capturing || parsing} type="submit">
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
          input={result.input}
          onChange={change}
        />
      ) : null}

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function CaptureDetails({
  configuration,
  input,
  onChange,
}: {
  configuration: TaskCollectionConfiguration;
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
        <label className="form-field">
          <span>Status</span>
          <select
            value={input.status ?? configuration.defaults.status}
            onChange={(event) => onChange({ status: event.target.value })}
          >
            {configuration.statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Priority</span>
          <select
            value={input.priority ?? configuration.defaults.priority}
            onChange={(event) => onChange({ priority: event.target.value })}
          >
            {configuration.priorities.map((priority) => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <CaptureList
          label="Projects"
          value={input.projects}
          onChange={(projects) => onChange({ projects })}
        />
        <CaptureList
          label="Contexts"
          value={input.contexts}
          onChange={(contexts) => onChange({ contexts })}
        />
        <CaptureList
          label="Tags"
          value={input.tags}
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
        <label className="form-field">
          <span>Repeat</span>
          <select
            value={recurrencePreset(input.recurrence)}
            onChange={(event) => {
              const value = event.target.value;
              onChange({
                recurrence:
                  value === "never"
                    ? undefined
                    : (recurrenceRule(value) ?? input.recurrence),
              });
            }}
          >
            <option value="never">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            {recurrencePreset(input.recurrence) === "custom" ? (
              <option value="custom">Custom rule</option>
            ) : null}
          </select>
        </label>
      </div>
      <label className="notes-field capture-notes">
        <span>Notes</span>
        <textarea
          rows={3}
          value={input.body ?? ""}
          onChange={(event) => onChange({ body: event.target.value })}
        />
      </label>
    </div>
  );
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
  const date = taskDatePart(value);
  const time = taskTimePart(value);
  return (
    <label className="form-field date-time-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={`${label} date`}
          type="date"
          value={date}
          onChange={(event) =>
            onChange(combineTaskDateTime(event.target.value, time))
          }
        />
        <input
          aria-label={`${label} time`}
          disabled={!date}
          type="time"
          value={time}
          onChange={(event) =>
            onChange(combineTaskDateTime(date, event.target.value))
          }
        />
      </div>
    </label>
  );
}

function CaptureList({
  label,
  value = [],
  onChange,
}: {
  label: string;
  value?: string[];
  onChange(value: string[]): void;
}) {
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
