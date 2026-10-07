import { i18n, type Messages } from "@lingui/core";
import english from "./locales/en/messages.json";
import french from "./locales/fr/messages.json";
import { requestedPilotLocale } from "./pilot";

// CI validates these compiler-owned ICU arrays; JSON imports lose their tuple types.
// Synchronous, bundled data. English works before any component or collection opens.
i18n.load({ en: english.messages as unknown as Messages });
if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
  i18n.load({
    fr: {
      ...(english.messages as unknown as Messages),
      ...(french.messages as unknown as Messages),
    },
  });
}
i18n.activate("en");

export function initializeAppI18n(locale = requestedPilotLocale()) {
  // The complete French catalogue remains preview-only, not a production language switch.
  const preview = import.meta.env.DEV || import.meta.env.MODE === "e2e";
  const selected = preview && locale === "fr" ? "fr" : "en";
  if (i18n.locale !== selected) i18n.activate(selected);
  if (typeof document !== "undefined") document.documentElement.lang = selected;
  return i18n;
}

export function appLocale(): string {
  return i18n.locale || "en";
}
