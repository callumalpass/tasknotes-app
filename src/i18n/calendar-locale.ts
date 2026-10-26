import type { LocaleInput } from "@fullcalendar/core";

const loaders: Record<string, () => Promise<{ default: LocaleInput }>> = {
  fr: () => import("@fullcalendar/core/locales/fr"),
  de: () => import("@fullcalendar/core/locales/de"),
  es: () => import("@fullcalendar/core/locales/es"),
  ja: () => import("@fullcalendar/core/locales/ja"),
  ko: () => import("@fullcalendar/core/locales/ko"),
  pt: () => import("@fullcalendar/core/locales/pt-br"),
  ru: () => import("@fullcalendar/core/locales/ru"),
  zh: () => import("@fullcalendar/core/locales/zh-cn"),
  it: () => import("@fullcalendar/core/locales/it"),
};

/** Calendar dependency copy follows the app language without eager locale data. */
export async function loadCalendarLocale(
  locale: string,
): Promise<LocaleInput | string> {
  const load = loaders[locale.split("-")[0]];
  return load ? (await load()).default : "en";
}
