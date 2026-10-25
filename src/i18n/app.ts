import {
  I18n,
  type MessageDescriptor,
  type MessageOptions,
} from "@lingui/core";
import { i18n, uiCatalogues } from "@mdbase-dev/ui/i18n";
import { createI18nRuntime, type Locale } from "@mdbase-dev/i18n";
import english from "./locales/en/messages.json";

const loaders = {
  fr: () => import("./locales/fr/messages.json"),
  de: () => import("./locales/de/messages.json"),
  es: () => import("./locales/es/messages.json"),
  ja: () => import("./locales/ja/messages.json"),
  ko: () => import("./locales/ko/messages.json"),
  pt: () => import("./locales/pt/messages.json"),
  ru: () => import("./locales/ru/messages.json"),
  zh: () => import("./locales/zh/messages.json"),
  it: () => import("./locales/it/messages.json"),
};

export const localeStorageKey = "tasknotes:locale";

// Lingui 6.9 decodes JS escapes after interpolation, including user text.
// Encode backslashes for that single decoding pass; never change stored values.
const renderMessage = I18n.prototype._.bind(i18n);
i18n._ = (
  id: string | MessageDescriptor,
  values?: Record<string, unknown>,
  options?: MessageOptions,
) =>
  typeof id === "string"
    ? renderMessage(id, literalValues(values), options)
    : renderMessage({ ...id, values: literalValues(id.values) });
i18n.t = i18n._.bind(i18n);

function literalValues(values?: Record<string, unknown>) {
  return (
    values &&
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replace(/\\/g, "\\u005c") : value,
      ]),
    )
  );
}

/** One singleton for React and presentation macros. English is synchronous. */
export const appRuntime = createI18nRuntime({
  i18n,
  english,
  libraries: [uiCatalogues],
  loadLocale: async (locale) => (await loaders[locale]()).default,
  storage: {
    getLocale() {
      try {
        return localStorage.getItem(localeStorageKey);
      } catch {
        return null;
      }
    },
    setLocale(locale) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(localeStorageKey, locale);
      } catch (error) {
        console.warn(
          "TaskNotes language preference could not be saved.",
          error,
        );
      }
    },
  },
});

export function initializeAppI18n() {
  return appRuntime.i18n;
}

export function activateAppLocale(locale: Locale): Promise<void> {
  return appRuntime.selectLocale(locale);
}

/** Display formatting only; catalogue and persisted locale keys stay two-letter. */
export function appLocale(): string {
  return i18n.locale === "pt"
    ? "pt-BR"
    : i18n.locale === "zh"
      ? "zh-CN"
      : i18n.locale || "en";
}
