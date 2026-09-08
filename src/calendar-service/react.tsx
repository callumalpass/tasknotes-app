import { useState } from "react";
import { calendarLabClient } from "./client";
import { useCalendarLabSnapshot } from "./hooks";

export function CalendarLabSettings() {
  const state = useCalendarLabSnapshot();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = calendarLabClient;
  if (!client) return null;
  return (
    <section aria-label="Google Calendar LAB" className="calendar-lab-settings">
      <h3>Google Calendar · LAB</h3>
      <p>
        Read-only events, separate from your tasks. Sign-in lasts until this
        page reloads. Google credentials stay in the calendar service.
      </p>
      {state.message && <p role="alert">{state.message}</p>}
      {state.busy && (
        <p role="status">
          Waiting for the calendar service or Google authorization…
        </p>
      )}
      {!state.signedIn ? (
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void client.authorize(false)}
        >
          Sign in to Calendar LAB
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void client.authorize(true)}
          >
            {state.connection
              ? "Reconnect Google Calendar"
              : "Connect Google Calendar"}
          </button>
          {state.connection?.status === "reconnect_required" && (
            <p>Google Calendar needs to be reconnected.</p>
          )}
          {state.connection && (
            <>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => void client.refresh()}
              >
                Refresh calendars
              </button>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => void client.disconnect()}
              >
                Disconnect Google Calendar
              </button>
            </>
          )}
          {state.calendars.length > 0 && (
            <fieldset>
              <legend>Show calendars (up to five)</legend>
              {state.calendars.map((calendar) => (
                <label key={calendar.id}>
                  <input
                    type="checkbox"
                    checked={state.selected.includes(calendar.id)}
                    disabled={
                      state.busy ||
                      (state.selected.length >= 5 &&
                        !state.selected.includes(calendar.id))
                    }
                    onChange={(event) =>
                      client.select(calendar.id, event.target.checked)
                    }
                  />
                  {calendar.name}
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void client.signOut()}
          >
            Sign out of Calendar LAB
          </button>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete Calendar LAB account…
          </button>
          {confirmDelete && (
            <div>
              <p>
                Delete all Calendar LAB connections and sessions? This does not
                delete Google events, tasks, or your mdbase account.
              </p>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  setConfirmDelete(false);
                  void client.deleteAccount();
                }}
              >
                Delete Calendar LAB account
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {state.busy && (
        <button type="button" onClick={() => client.forget()}>
          Cancel and forget local session
        </button>
      )}
    </section>
  );
}
