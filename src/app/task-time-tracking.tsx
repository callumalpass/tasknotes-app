import { Clock3, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { TaskNotesDateTimeField } from "../components/tasknotes-controls";
import { activeTimeEntry, taskTimeTotals } from "../domain/task";
import { cleanOperationError } from "./operation-error";

import type { TaskTimeEntry } from "../domain/task";

export function TimeTrackingField({
  entries,
  busy,
  error,
  onStart,
  onStop,
  onReplace,
  onRemove,
}: {
  entries: TaskTimeEntry[];
  busy: boolean;
  error: string | null;
  onStart(description?: string): void;
  onStop(): void;
  onReplace(entries: TaskTimeEntry[]): void;
  onRemove(index: number): void;
}) {
  const active = activeTimeEntry(entries);
  const now = useTimerNow(Boolean(active));
  const totals = taskTimeTotals(entries, now);
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const visibleEntries = entries.slice(-50).reverse();

  return (
    <section className="time-tracking" aria-labelledby="time-tracking-title">
      <div className="time-tracking-heading">
        <div>
          <h2 id="time-tracking-title">
            <Clock3 aria-hidden="true" size={16} strokeWidth={1.7} /> Time
          </h2>
          <p>
            {active
              ? `${formatMinutes(totals.liveMinutes)} tracked`
              : formatMinutes(totals.closedMinutes)}
          </p>
        </div>
        {active ? (
          <button
            className="timer-action is-running"
            disabled={busy}
            type="button"
            onClick={onStop}
          >
            <Square aria-hidden="true" size={14} fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            className="timer-action"
            disabled={busy}
            type="button"
            onClick={() => {
              onStart(description.trim() || undefined);
              setDescription("");
            }}
          >
            <Play aria-hidden="true" size={15} fill="currentColor" /> Start
          </button>
        )}
      </div>

      {!active ? (
        <input
          aria-label="Timer description"
          className="timer-description"
          placeholder="What are you working on?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      ) : (
        <p className="active-session" aria-live="polite">
          {active.description || "Work session"} · {formatSession(active, now)}
        </p>
      )}

      {error ? (
        <p className="inline-error" role="alert">
          {cleanOperationError(error)}
        </p>
      ) : null}

      {entries.length ? (
        <button
          aria-expanded={expanded}
          className="text-action time-history-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Hide sessions"
            : `${entries.length} session${entries.length === 1 ? "" : "s"}`}
        </button>
      ) : null}

      {expanded ? (
        <div className="time-entry-list">
          {entries.length > visibleEntries.length ? (
            <p className="time-entry-limit">
              Showing the latest {visibleEntries.length} of {entries.length}
              sessions.
            </p>
          ) : null}
          {visibleEntries.map((entry, reversedIndex) => {
            const index = entries.length - reversedIndex - 1;
            return editing === index ? (
              <TimeEntryEditor
                entry={entry}
                key={`${entry.startTime}:${index}`}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                  const replacement = entries.map((value, entryIndex) =>
                    entryIndex === index ? next : value,
                  );
                  onReplace(replacement);
                  setEditing(null);
                }}
              />
            ) : (
              <div
                className="time-entry-row"
                key={`${entry.startTime}:${index}`}
              >
                <button type="button" onClick={() => setEditing(index)}>
                  <strong>{entry.description || "Work session"}</strong>
                  <span>{formatSessionRange(entry, now)}</span>
                </button>
                <button
                  aria-label={`Remove ${entry.description || "session"}`}
                  className="icon-action"
                  disabled={busy}
                  type="button"
                  onClick={() => onRemove(index)}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.6} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function TimeEntryEditor({
  entry,
  onSave,
  onCancel,
}: {
  entry: TaskTimeEntry;
  onSave(entry: TaskTimeEntry): void;
  onCancel(): void;
}) {
  const [start, setStart] = useState(toLocalDateTime(entry.startTime));
  const [end, setEnd] = useState(toLocalDateTime(entry.endTime));
  const [description, setDescription] = useState(entry.description ?? "");
  const valid = Boolean(start && (!end || new Date(end) >= new Date(start)));
  return (
    <div className="time-entry-editor">
      <input
        aria-label="Session description"
        placeholder="Session description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div>
        <TaskNotesDateTimeField
          label="Session start"
          value={start}
          onChange={(value) => setStart(value ?? "")}
        />
        <TaskNotesDateTimeField
          label="Session end"
          value={end}
          onChange={(value) => setEnd(value ?? "")}
        />
      </div>
      <div className="time-entry-editor-actions">
        <button className="text-action" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="text-action"
          disabled={!valid}
          type="button"
          onClick={() =>
            onSave({
              startTime: new Date(start).toISOString(),
              ...(end ? { endTime: new Date(end).toISOString() } : {}),
              ...(description.trim()
                ? { description: description.trim() }
                : {}),
            })
          }
        >
          Save session
        </button>
      </div>
    </div>
  );
}

function useTimerNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSession(entry: TaskTimeEntry, now: Date): string {
  return formatMinutes(taskTimeTotals([entry], now).liveMinutes);
}

function formatSessionRange(entry: TaskTimeEntry, now: Date): string {
  const start = new Date(entry.startTime);
  const end = entry.endTime ? new Date(entry.endTime) : now;
  const day = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time.format(start)}–${time.format(end)} · ${formatSession(entry, now)}`;
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
