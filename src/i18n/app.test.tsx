import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { act, render, screen } from "../test/render";
import { initializeAppI18n, appLocale } from "./app";
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
import { editorPhrases } from "./editor-phrases";
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  initializeAppI18n("en");
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
    expect(initializeAppI18n("en").locale).toBe("en");
    expect(countLabel(1, "task")).toBe("1 task");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares context with portal content and updates document language", () => {
    initializeAppI18n("en");
    render(
      <AppI18nProvider>
        <ControlsAndPortal />
      </AppI18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeVisible();
    act(() => {
      initializeAppI18n("fr");
    });
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

  it("falls back for unsupported locales", () => {
    expect(initializeAppI18n("de").locale).toBe("en");
    expect(appLocale()).toBe("en");
  });

  it("never enables the preview locale in an ordinary production build", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    expect(initializeAppI18n("fr").locale).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it.each(["en", "fr"])(
    "renders authored zero/one/many copy in %s",
    (locale) => {
      initializeAppI18n(locale);
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

  it("formats authored French ordinals with CLDR instead of English suffix assumptions", () => {
    expect([1, 2, 3, 11, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "11th",
      "21st",
    ]);
    initializeAppI18n("fr");
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

  it("retains raw record values and explicit user-provided property labels", () => {
    initializeAppI18n("fr");
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

  it("renders French field, recurrence, date and editor copy while preserving syntax", () => {
    initializeAppI18n("fr");
    expect(builtInFieldLabel("due")).toBe("Échéance");
    expect(daySectionLabel("anytime", "ignored")).toBe("Sans date");
    expect(formatTaskDate("2026-07-24", "2026-07-24")).toBe("Aujourd’hui");
    expect(formatRelativeTaskDate("2026-07-22", "2026-07-24")).toBe(
      "Il y a 2 jours",
    );
    const rule = "FREQ=MONTHLY;BYDAY=2MO";
    expect(recurrenceRuleSummary(parseRecurrenceRule(rule))).toBe(
      "Tous les mois, le deuxième lundi",
    );
    expect(
      recurrenceRuleSummary(
        parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"),
      ),
    ).toBe("Toutes les 2 semaines, les jours suivants : lundi et mercredi");
    const phrases = editorPhrases();
    expect(phrases["Go to line"]).toBe("Aller à la ligne");
    expect(phrases["replaced match on line $"]).toBe(
      "correspondance remplacée à la ligne $",
    );
    expect(phrases["replaced $ matches"]).toBe("$ correspondances remplacées");
  });

  it("preserves editor phrase lookup keys and substitution tokens", () => {
    const phrases = editorPhrases();
    expect(phrases["Go to line"]).toBe("Go to line");
    expect(phrases["replaced match on line $"]).toBe(
      "replaced match on line $",
    );
    expect(phrases["replaced $ matches"]).toBe("replaced $ matches");
  });
});
