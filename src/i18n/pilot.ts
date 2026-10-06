import { setupI18n, type Messages } from "@lingui/core";
import english from "./locales/en/messages.json";
import french from "./locales/fr/messages.json";

/** Trusted build output is JSON ICU data, never downloaded executable functions. */
export function createPilotI18n(
  locale = "en",
  target: Messages = french.messages as unknown as Messages,
) {
  return setupI18n({
    locale: locale === "fr" ? "fr" : "en",
    messages: {
      en: english.messages as unknown as Messages,
      fr: { ...(english.messages as unknown as Messages), ...target },
    },
  });
}

export function requestedPilotLocale(): string {
  // No storage, network, auth or provider-specific branching. Release UI remains English.
  if (!import.meta.env.DEV && import.meta.env.MODE !== "e2e") return "en";
  return new URLSearchParams(window.location.search).get("i18n-pilot") === "fr"
    ? "fr"
    : "en";
}
