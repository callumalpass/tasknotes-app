import { i18n } from "@lingui/core";
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
};

export const localeStorageKey = "tasknotes:locale";

/** One singleton for React and presentation macros. English is synchronous. */
export const appRuntime = createI18nRuntime({
  i18n,
  english,
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
