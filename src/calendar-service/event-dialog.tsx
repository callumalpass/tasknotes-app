import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, Video } from "lucide-react";
import { useRef, useState } from "react";
import { useOverlay } from "../components/overlays/use-overlay";
import { TaskNotesSelectField } from "../components/tasknotes-controls";
import { runtimeTimezone } from "../domain/runtime-timezone";
import {
  calendarServiceClient,
  CalendarServiceError,
  type CalendarServiceFailure,
  type GoogleCalendar,
  type GoogleEvent,
} from "./client";
import {
  changedFields,
  draftFields,
  draftIsValid,
  eventDraft,
  rebaseDraft,
  withAllDay,
  type EventDraft,
} from "./event-draft";
import { eventLinks } from "./event-links";
import { calendarServiceFailureMessage } from "./failure-message";
import type { EventEditorRequest } from "./use-google-calendar-overlay";

/** Views or edits one Google event; a recurring event changes one occurrence. */
export function GoogleEventDialog({
  request,
  events,
  writable,
  onClose,
  onSaved,
  onChanged,
}: {
  request: EventEditorRequest;
  events: readonly GoogleEvent[];
  writable: readonly GoogleCalendar[];
  onClose(): void;
  onSaved(event: GoogleEvent): void;
  onChanged(): void;
}) {
  const { t } = useLingui();
  const client = calendarServiceClient!;
  const rootRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useOverlay({
    open: true,
    rootRef,
    modal: true,
    onDismiss: onClose,
    initialFocus: () => titleRef.current,
  });
  const existing = request.kind === "existing" ? request : null;
  // The version the draft is based on; its etag guards every write from here.
  const [event, setEvent] = useState(existing?.event ?? null);
  const [draft, setDraft] = useState<EventDraft>(() =>
    request.kind === "existing" ? eventDraft(request.event) : request.draft,
  );
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [failure, setFailure] = useState<CalendarServiceFailure | null>(null);
  const latest = existing && events.find(({ id }) => id === existing.id);
  if (failure === "conflict" && event && latest && latest.etag !== event.etag) {
    setEvent(latest);
    setDraft(rebaseDraft(eventDraft(event), draft, eventDraft(latest)));
  }
  const editable = existing ? existing.calendar.can_write : true;
  const change = (patch: Partial<EventDraft>) =>
    setDraft((value) => ({ ...value, ...patch }));

  async function attempt(action: () => Promise<unknown>) {
    setSaving(true);
    setFailure(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (reason) {
      setFailure(
        reason instanceof CalendarServiceError ? reason.failure : "unavailable",
      );
      setConfirmingDelete(false);
      setSaving(false);
      onChanged();
    }
  }

  function save() {
    const timeZone = runtimeTimezone();
    void attempt(async () => {
      if (request.kind === "new") {
        await client.createEvent(
          calendarId,
          draftFields(draft, timeZone),
          request.idempotencyKey,
        );
        return;
      }
      const fields = changedFields(event!, draft, timeZone);
      if (Object.keys(fields).length)
        onSaved(await client.updateEvent(event!, fields));
    });
  }

  const inputType = draft.allDay ? "date" : "datetime-local";
  const links = event ? eventLinks(event) : null;
  return (
    <div className="recurring-scope-layer">
      <button
        aria-label={t({ message: "Close" })}
        className="recurring-scope-scrim"
        tabIndex={-1}
        type="button"
        onClick={onClose}
      />
      <section
        aria-labelledby="google-event-heading"
        className="google-event-dialog"
        ref={rootRef}
        role="dialog"
      >
        <header>
          <h2 id="google-event-heading">
            {existing
              ? editable
                ? t({ message: "Edit Google event" })
                : t({ message: "Google event" })
              : t({ message: "New Google event" })}
          </h2>
          <small>{existing?.calendar.name}</small>
        </header>
        {links?.join || links?.google ? (
          <nav
            aria-label={t({ message: "Event links" })}
            className="google-event-links"
          >
            {links.join ? (
              <a
                className="secondary-action"
                href={links.join.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Video aria-hidden="true" size={18} />
                <span>{t({ message: "Join meeting" })}</span>
                {/* The link comes with the invitation, so say where it leads. */}
                <small>{links.join.host}</small>
              </a>
            ) : null}
            {links.google ? (
              <a
                className="text-action"
                href={links.google}
                rel="noopener noreferrer"
                target="_blank"
              >
                <span>{t({ message: "Open in Google Calendar" })}</span>
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
            ) : null}
          </nav>
        ) : null}
        <form
          onSubmit={(submit) => {
            submit.preventDefault();
            if (editable && draftIsValid(draft)) save();
          }}
        >
          <label>
            <span>{t({ message: "Title" })}</span>
            <input
              disabled={!editable || saving}
              ref={titleRef}
              value={draft.title}
              onChange={({ target }) => change({ title: target.value })}
            />
          </label>
          {existing ? null : (
            <TaskNotesSelectField
              label={t({ message: "Calendar" })}
              options={writable.map((calendar) => ({
                value: calendar.id,
                label: calendar.name,
              }))}
              value={calendarId}
              onChange={setCalendarId}
            />
          )}
          <label className="google-event-all-day">
            <input
              checked={draft.allDay}
              disabled={!editable || saving}
              type="checkbox"
              onChange={({ target }) =>
                setDraft((value) => withAllDay(value, target.checked))
              }
            />
            <span>{t({ message: "All day" })}</span>
          </label>
          <div className="google-event-times">
            <label>
              <span>{t({ message: "Starts" })}</span>
              <input
                disabled={!editable || saving}
                required
                type={inputType}
                value={draft.start}
                onChange={({ target }) => change({ start: target.value })}
              />
            </label>
            <label>
              <span>{t({ message: "Ends" })}</span>
              <input
                disabled={!editable || saving}
                required
                type={inputType}
                value={draft.end}
                onChange={({ target }) => change({ end: target.value })}
              />
            </label>
          </div>
          <label>
            <span>{t({ message: "Location" })}</span>
            <input
              disabled={!editable || saving}
              value={draft.location}
              onChange={({ target }) => change({ location: target.value })}
            />
          </label>
          <label>
            <span>{t({ message: "Description" })}</span>
            <textarea
              disabled={!editable || saving}
              rows={4}
              value={draft.description}
              onChange={({ target }) => change({ description: target.value })}
            />
          </label>
          {!editable ? (
            <p>{t({ message: "This calendar is read-only." })}</p>
          ) : event?.recurrence ? (
            <p>{t({ message: "Changes apply to this occurrence only." })}</p>
          ) : null}
          {draftIsValid(draft) ? null : (
            <p className="inline-error" role="alert">
              {t({ message: "The event must end after it starts." })}
            </p>
          )}
          {failure ? (
            <p className="inline-error" role="alert">
              {calendarServiceFailureMessage(failure)}
            </p>
          ) : null}
          <footer>
            {editable && event ? (
              confirmingDelete ? (
                <button
                  className="text-action google-event-delete"
                  disabled={saving}
                  type="button"
                  onClick={() => void attempt(() => client.deleteEvent(event))}
                >
                  {t({ message: "Confirm delete" })}
                </button>
              ) : (
                <button
                  className="text-action google-event-delete"
                  disabled={saving}
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t({ message: "Delete" })}
                </button>
              )
            ) : null}
            <button className="text-action" type="button" onClick={onClose}>
              {editable ? t({ message: "Cancel" }) : t({ message: "Close" })}
            </button>
            {editable ? (
              <button
                className="primary-action"
                disabled={saving || !draftIsValid(draft)}
                type="submit"
              >
                {t({ message: "Save" })}
              </button>
            ) : null}
          </footer>
        </form>
      </section>
    </div>
  );
}
