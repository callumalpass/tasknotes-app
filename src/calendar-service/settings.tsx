import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { calendarTone } from "./calendar-tone";
import { calendarServiceClient, MAX_SELECTED_CALENDARS } from "./client";
import { calendarServiceFailureMessage } from "./failure-message";
import { useCalendarService } from "./use-calendar-service";

/** Connects Google Calendar for this page; loaded only when a service origin is built in. */
export function CalendarServiceSettings() {
  const { t } = useLingui();
  const state = useCalendarService();
  const client = calendarServiceClient!;
  const [code, setCode] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const signedIn = state.sessionId !== null;
  const connected = state.connection?.status === "active";
  const reconnect = state.connection?.status === "reconnect_required";
  return (
    <section
      aria-label={t({ message: "Google Calendar" })}
      className="google-calendar-settings"
    >
      <div className="google-calendar-settings-status">
        <div>
          <strong>
            <Trans>Google Calendar</Trans>
          </strong>
          <small>
            {connected ? (
              <Trans>Connected</Trans>
            ) : reconnect ? (
              <Trans>Needs reconnecting</Trans>
            ) : signedIn ? (
              <Trans>Signed in. Connect your calendars next.</Trans>
            ) : (
              <Trans>Not connected</Trans>
            )}
          </small>
        </div>
        {state.busy || connected ? null : (
          <button
            className="primary-action"
            type="button"
            onClick={() => void (signedIn ? client.connect() : client.signIn())}
          >
            {signedIn
              ? reconnect
                ? t({ message: "Reconnect" })
                : t({ message: "Connect calendars" })
              : t({ message: "Sign in with Google" })}
          </button>
        )}
      </div>
      {state.failure ? (
        <p className="inline-error" role="alert">
          {calendarServiceFailureMessage(state.failure)}
        </p>
      ) : null}
      {state.awaitingCode ? (
        <form
          className="google-calendar-code"
          onSubmit={(event) => {
            event.preventDefault();
            client.submitCode(code);
            setCode("");
          }}
        >
          <label>
            <span>
              <Trans>Enter the code shown in the Google window</Trans>
            </span>
            <input
              autoComplete="off"
              autoFocus
              maxLength={8}
              required
              spellCheck={false}
              value={code}
              onChange={({ target }) => setCode(target.value)}
            />
          </label>
          <button className="primary-action" type="submit">
            <Trans>Confirm</Trans>
          </button>
        </form>
      ) : null}
      {state.busy ? (
        <div className="google-calendar-settings-pending">
          {state.awaitingCode ? null : (
            <p role="status">
              <Trans>Finish in the Google window.</Trans>
            </p>
          )}
          <button
            className="text-action"
            type="button"
            onClick={client.cancelAuthorization}
          >
            <Trans>Stop waiting</Trans>
          </button>
        </div>
      ) : null}
      {connected ? (
        <fieldset className="google-calendar-choices">
          <legend>
            <Trans>Show in the calendar</Trans>
          </legend>
          {state.calendars.map((calendar, index) => {
            const checked = state.selected.includes(calendar.id);
            return (
              <label key={calendar.id}>
                <input
                  checked={checked}
                  disabled={
                    !checked && state.selected.length >= MAX_SELECTED_CALENDARS
                  }
                  type="checkbox"
                  onChange={({ target }) =>
                    client.setSelected(
                      target.checked
                        ? [...state.selected, calendar.id]
                        : state.selected.filter((id) => id !== calendar.id),
                    )
                  }
                />
                <i
                  aria-hidden="true"
                  style={{
                    background: calendarTone(calendar.color, index),
                  }}
                />
                <span>{calendar.name}</span>
                {calendar.can_write ? null : (
                  <small>
                    <Trans>Read-only</Trans>
                  </small>
                )}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {signedIn ? (
        <div className="google-calendar-settings-actions">
          {state.connection ? (
            <button
              className="text-action"
              disabled={state.busy}
              type="button"
              onClick={() => void client.disconnect()}
            >
              <Trans>Disconnect calendars</Trans>
            </button>
          ) : null}
          <button
            className="text-action"
            disabled={state.busy}
            type="button"
            onClick={() => void client.signOut()}
          >
            <Trans>Sign out</Trans>
          </button>
          <button
            className="text-action google-event-delete"
            disabled={state.busy}
            type="button"
            onClick={() =>
              confirmingDelete
                ? void client.deleteAccount()
                : setConfirmingDelete(true)
            }
          >
            {confirmingDelete
              ? t({ message: "Confirm: delete account" })
              : t({ message: "Delete calendar account" })}
          </button>
        </div>
      ) : null}
      <small>
        <Trans>
          You stay signed in here until you sign out. Deleting the account
          removes the connection, not your Google events or tasks.
        </Trans>
      </small>
    </section>
  );
}
