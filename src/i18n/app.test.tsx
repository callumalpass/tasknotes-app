import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { act, fireEvent, render, screen } from "../test/render";
import { LanguageSettings } from "./language-settings";
import {
  initializeAppI18n,
  activateAppLocale,
  appLocale,
  localeStorageKey,
} from "./app";
import { locales, type Locale } from "@mdbase-dev/i18n";
import { AppI18nProvider } from "./app-provider";
import {
  countLabel,
  builtInFieldLabel,
  daySectionLabel,
} from "./default-labels";
import {
  formatRelativeTaskDate,
  formatTaskDate,
  ordinal,
  recurrenceRuleSummary,
} from "./presentation";
import {
  formatPropertyValue,
  propertyLabel,
  relativeDateDetail,
  viewPropertyDetails,
} from "./view-presentation";
import {
  englishCodeMirrorPhrases,
  loadCodeMirrorPhrases,
} from "@mdbase-dev/i18n/codemirror";
import { uiCopy } from "./ui-copy";
import { parseRecurrenceRule } from "../domain/recurrence-rule";
import type { TaskViewRow } from "../domain/view";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

const row: TaskViewRow = {
  task: {
    id: "one",
    path: "tasks/one.md",
    title: "Keep my title",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    tags: ["task"],
    projects: [],
    contexts: [],
    attachments: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    frontmatter: {},
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  values: { 'note["due"]': "2026-07-24", 'note["title"]': "Keep my title" },
};

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await act(() => activateAppLocale("en"));
});

function ControlsAndPortal() {
  const { t } = useLingui();
  return (
    <>
      <button>
        <Trans>Refresh now</Trans>
      </button>
      <button aria-label={t`Actions for ${uiCopy("empty item")}`}>
        <Trans>Actions</Trans>
      </button>
      {createPortal(
        <aside>
          <Trans>Refresh now</Trans>
        </aside>,
        document.body,
      )}
    </>
  );
}

describe("application localization", () => {
  it("loads English immediately without network access", () => {
    const fetch = vi.fn(() => {
      throw new Error("No translation network");
    });
    vi.stubGlobal("fetch", fetch);
    expect(initializeAppI18n().locale).toBe("en");
    expect(countLabel(1, "task")).toBe("1 task");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares context with portal content and updates document language", async () => {
    await activateAppLocale("en");
    render(
      <AppI18nProvider>
        <ControlsAndPortal />
      </AppI18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeVisible();
    await act(() => activateAppLocale("fr"));
    expect(
      screen.getByRole("button", { name: "Actualiser maintenant" }),
    ).toBeVisible();
    expect(screen.getByRole("complementary")).toHaveTextContent(
      "Actualiser maintenant",
    );
    expect(document.documentElement.lang).toBe("fr");
    expect(
      screen.getByRole("button", { name: "Actions pour élément vide" }),
    ).toBeVisible();
  });

  it("switches and persists the Settings language without remounting user content", async () => {
    render(
      <>
        <LanguageSettings />
        <ControlsAndPortal />
        <input aria-label="User content" defaultValue="Keep my title" />
      </>,
    );
    const picker = screen.getByRole("combobox", { name: "App language" });
    expect(picker.querySelectorAll("option")).toHaveLength(9);
    fireEvent.change(picker, { target: { value: "fr" } });
    expect(
      await screen.findByRole("button", { name: "Actualiser maintenant" }),
    ).toBeVisible();
    expect(picker).toHaveValue("fr");
    expect(localStorage.getItem(localeStorageKey)).toBe("fr");
    expect(screen.getByRole("textbox", { name: "User content" })).toHaveValue(
      "Keep my title",
    );
  });

  it("rejects unsupported explicit locales without changing the current language", async () => {
    await expect(activateAppLocale("zz" as Locale)).rejects.toThrow(
      "Unsupported locale",
    );
    expect(appLocale()).toBe("en");
  });

  it.each(locales)("enables and persists %s in production", async (locale) => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    await activateAppLocale(locale);
    expect(initializeAppI18n().locale).toBe(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(localStorage.getItem(localeStorageKey)).toBe(locale);
  });

  it.each(["en", "fr"])(
    "renders authored zero/one/many copy in %s",
    async (locale) => {
      await activateAppLocale(locale as Locale);
      expect([0, 1, 2].map((count) => countLabel(count, "task"))).toEqual(
        locale === "fr"
          ? ["0 tâches", "1 tâche", "2 tâches"]
          : ["0 tasks", "1 task", "2 tasks"],
      );
      expect([0, 1, 2].map((count) => countLabel(count, "dependency"))).toEqual(
        locale === "fr"
          ? ["0 dépendances", "1 dépendance", "2 dépendances"]
          : ["0 dependencies", "1 dependency", "2 dependencies"],
      );
    },
  );

  it.each([
    {
      locale: "en",
      expected: [
        "0 tasks",
        "1 task",
        "2 tasks",
        "5 tasks",
        "11 tasks",
        "21 tasks",
        "22 tasks",
        "101 tasks",
      ],
    },
    {
      locale: "fr",
      expected: [
        "0 tâches",
        "1 tâche",
        "2 tâches",
        "5 tâches",
        "11 tâches",
        "21 tâches",
        "22 tâches",
        "101 tâches",
      ],
    },
    {
      locale: "de",
      expected: [
        "0 Aufgaben",
        "1 Aufgabe",
        "2 Aufgaben",
        "5 Aufgaben",
        "11 Aufgaben",
        "21 Aufgaben",
        "22 Aufgaben",
        "101 Aufgaben",
      ],
    },
    {
      locale: "es",
      expected: [
        "0 tareas",
        "1 tarea",
        "2 tareas",
        "5 tareas",
        "11 tareas",
        "21 tareas",
        "22 tareas",
        "101 tareas",
      ],
    },
    {
      locale: "ja",
      expected: [
        "タスク0件",
        "タスク1件",
        "タスク2件",
        "タスク5件",
        "タスク11件",
        "タスク21件",
        "タスク22件",
        "タスク101件",
      ],
    },
    {
      locale: "ko",
      expected: [
        "작업 0개",
        "작업 1개",
        "작업 2개",
        "작업 5개",
        "작업 11개",
        "작업 21개",
        "작업 22개",
        "작업 101개",
      ],
    },
    {
      locale: "pt",
      expected: [
        "0 tarefas",
        "1 tarefa",
        "2 tarefas",
        "5 tarefas",
        "11 tarefas",
        "21 tarefas",
        "22 tarefas",
        "101 tarefas",
      ],
    },
    {
      locale: "ru",
      expected: [
        "0 задач",
        "1 задача",
        "2 задачи",
        "5 задач",
        "11 задач",
        "21 задача",
        "22 задачи",
        "101 задача",
      ],
    },
    {
      locale: "zh",
      expected: [
        "0 个任务",
        "1 个任务",
        "2 个任务",
        "5 个任务",
        "11 个任务",
        "21 个任务",
        "22 个任务",
        "101 个任务",
      ],
    },
  ])(
    "renders authored 0/1/2/5/11/21/22/101 counts in $locale",
    async ({ locale, expected }) => {
      await activateAppLocale(locale as Locale);
      expect(
        [0, 1, 2, 5, 11, 21, 22, 101].map((count) => countLabel(count, "task")),
      ).toEqual(expected);
    },
  );

  it("formats authored French ordinals with CLDR instead of English suffix assumptions", async () => {
    expect([1, 2, 3, 11, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "11th",
      "21st",
    ]);
    await activateAppLocale("fr");
    expect([1, 2, 3, 11, 21].map(ordinal)).toEqual([
      "1er",
      "2e",
      "3e",
      "11e",
      "21e",
    ]);
  });

  it("keeps default field/day labels at the presentation boundary", () => {
    expect(builtInFieldLabel("due")).toBe("Due");
    expect(builtInFieldLabel("my_project")).toBeUndefined();
    expect(propertyLabel('note["my_project"]')).toBe("My project");
    expect(propertyLabel("file.name")).toBe("Name");
    expect(propertyLabel("file.path")).toBe("Path");
    expect(daySectionLabel("today", "ignored")).toBe("Today");
    expect(daySectionLabel("custom", "My collection")).toBe("My collection");
  });

  it("retains raw record values and explicit user-provided property labels", async () => {
    await activateAppLocale("fr");
    const before = structuredClone(row);
    const details = viewPropertyDetails(row, [
      { key: 'note["due"]', label: "My deadline" },
      { key: 'note["title"]', label: "My title" },
    ]);
    expect(details?.[0]).toMatchObject({
      key: 'note["due"]',
      label: "My deadline",
      rawValue: "2026-07-24",
    });
    expect(details?.[1]).toMatchObject({
      label: "My title",
      value: "Keep my title",
    });
    expect(row).toEqual(before);
    expect(formatPropertyValue("[[My collection]]")).toBe("My collection");
  });

  it("identifies mapped dates by stable keys, never by their localized labels", () => {
    const detail = {
      key: 'note["deadline"]',
      label: "Échéance",
      value: "unused",
      rawValue: "2026-07-24",
    };
    const displayed = relativeDateDetail(
      detail,
      { completed: false },
      {
        fieldMapping: {
          ...defaultTaskCollectionConfiguration().fieldMapping,
          due: "deadline",
          scheduled: "planned",
        },
      },
    );
    expect(displayed.value).toBe(formatRelativeTaskDate(detail.rawValue));
    expect(displayed.label).toBe("Échéance");
    expect(detail.value).toBe("unused");
  });

  it("uses plural and calendar presentation messages without altering recurrence storage", () => {
    expect(formatTaskDate("2026-07-24", "2026-07-24")).toBe("Today");
    expect(formatRelativeTaskDate("2026-07-22", "2026-07-24")).toBe(
      "2 days ago",
    );
    const draft = parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
    expect(recurrenceRuleSummary(draft)).toBe(
      "Every 2 weeks on Monday and Wednesday",
    );
    expect(draft.weekdays).toEqual(["MO", "WE"]);
  });

  it.each([2, 3, 11, 21, 22, 31])(
    "describes BYMONTHDAY=-%i as an inclusive ordinal from month end",
    (count) => {
      const draft = parseRecurrenceRule(`FREQ=MONTHLY;BYMONTHDAY=-${count}`);
      expect(recurrenceRuleSummary(draft)).toBe(
        `Every month on the ${ordinal(count)}-to-last day of the month`,
      );
      expect(draft.monthDay).toBe(-count);
    },
  );

  it("renders French field, recurrence, date and editor copy while preserving syntax", async () => {
    await activateAppLocale("fr");
    expect(builtInFieldLabel("due")).toBe("Échéance");
    expect(daySectionLabel("anytime", "ignored")).toBe("Sans date");
    expect(formatTaskDate("2026-07-24", "2026-07-24")).toBe("Aujourd’hui");
    expect(formatRelativeTaskDate("2026-07-22", "2026-07-24")).toBe(
      "Il y a 2 jours",
    );
    const rule = "FREQ=MONTHLY;BYDAY=2MO";
    expect(recurrenceRuleSummary(parseRecurrenceRule(rule))).toBe(
      "Chaque mois, le deuxième lundi",
    );
    expect(
      recurrenceRuleSummary(
        parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"),
      ),
    ).toBe("Toutes les 2 semaines, les jours suivants : lundi et mercredi");
    const phrases = await loadCodeMirrorPhrases("fr");
    expect(phrases["Go to line"]).toBe("Aller à la ligne");
    expect(phrases["replaced match on line $"]).toBe(
      "Correspondance remplacée à la ligne $",
    );
    expect(phrases["replaced $ matches"]).toBe("$ correspondances remplacées");
  });

  it("preserves editor phrase lookup keys and substitution tokens", () => {
    const phrases = englishCodeMirrorPhrases;
    expect(phrases["Go to line"]).toBe("Go to line");
    expect(phrases["replaced match on line $"]).toBe(
      "Replaced match on line $",
    );
    expect(phrases["replaced $ matches"]).toBe("Replaced $ matches");
  });
});
