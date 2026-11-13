import { t } from "@lingui/core/macro";
import type { CalendarServiceFailure } from "./client";

export function calendarServiceFailureMessage(
  failure: CalendarServiceFailure,
): string {
  switch (failure) {
    case "authorization_failed":
      return t`Google didn’t complete the authorization. Try again.`;
    case "authorization_expired":
      return t`The Google authorization expired. Try again.`;
    case "code_rejected":
      return t`That confirmation code wasn’t accepted, or it expired. Start again to get a new one.`;
    case "conflict":
      return t`This event changed in Google. The latest version has been loaded; review it and try again.`;
    case "invalid_authorization":
      return t`The authorization link wasn’t valid, so it wasn’t opened.`;
    case "invalid_request":
      return t`Google Calendar didn’t accept this change.`;
    case "not_found":
      return t`This event no longer exists in Google Calendar.`;
    case "pagination":
      return t`This period has too many events. Choose a shorter one.`;
    case "popup_blocked":
      return t`Allow popups for TaskNotes to sign in with Google.`;
    case "rate_limited":
      return t`Google Calendar is busy. Try again shortly.`;
    case "reconnect_required":
      return t`Google Calendar needs reconnecting. Reconnect in Settings.`;
    case "session_expired":
      return t`Your Google Calendar session ended. Sign in again in Settings.`;
    case "unavailable":
      return t`Google Calendar is unavailable right now. Try again.`;
  }
}
