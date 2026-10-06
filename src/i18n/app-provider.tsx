import { I18nProvider } from "@lingui/react";
import { useState, type ReactNode } from "react";
import { initializeAppI18n } from "./app";

/** One provider for collection access, the workspace, portals and the error boundary. */
export function AppI18nProvider({ children }: { children: ReactNode }) {
  const [i18n] = useState(() => initializeAppI18n());
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
