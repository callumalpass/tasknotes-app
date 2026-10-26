import { LocaleProvider } from "@mdbase-dev/i18n/react";
import type { ReactNode } from "react";
import { appRuntime } from "./app";

function reportLocaleError(error: unknown) {
  console.warn(
    "TaskNotes language could not load; keeping the current language.",
    error,
  );
}

/** Includes collection access, the workspace, portals and the error boundary. */
export function AppI18nProvider({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider runtime={appRuntime} onError={reportLocaleError}>
      {children}
    </LocaleProvider>
  );
}
