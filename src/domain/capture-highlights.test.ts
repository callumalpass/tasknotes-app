import { describe, expect, it } from "vitest";

import {
  currentCaptureHighlights,
  reflectedCaptureHighlights,
  type CaptureHighlight,
} from "./capture-highlights";
import { resolveTaskCollectionConfiguration } from "./task-configuration";
import { parseTaskCapture } from "./task-capture";

const configuration = resolveTaskCollectionConfiguration({
  name: "task",
  schema: {
    value: {
      type: "object",
      properties: {
        title: { type: "string", tn_role: "title" },
        status: {
          type: "string",
          tn_role: "status",
          enum: ["todo", "doing", "done"],
        },
        priority: {
          type: "string",
          tn_role: "priority",
          enum: ["normal", "high"],
        },
      },
    },
  },
  implements: [
    {
      contract: "tasknotes.task",
      version: "0.3.0-rc.5",
      fields: { title: "title", status: "status", priority: "priority" },
      binding: {
        status: {
          default: "todo",
          definitions: [
            { value: "todo", label: "To do", order: 0 },
            { value: "doing", label: "In progress", order: 1 },
            { value: "done", label: "Done", order: 2, is_completed: true },
          ],
        },
        priority: {
          default: "normal",
          definitions: [
            { value: "normal", label: "Normal", weight: 0 },
            { value: "high", label: "High", weight: 1 },
          ],
        },
      },
    },
  ],
});

async function highlights(text: string) {
  return (
    (await parseTaskCapture(text, configuration, "en-AU")).highlights ?? []
  );
}

async function phrases(text: string) {
  return (await highlights(text)).map((span) =>
    text.slice(span.start, span.end),
  );
}

describe("recognized capture phrases", () => {
  it("finds a trailing date and time as one phrase", async () => {
    expect(await phrases("Call Sam tomorrow at 3pm")).toEqual([
      "tomorrow at 3pm",
    ]);
  });

  it("separates each trigger from the surrounding date phrases", async () => {
    expect(
      await phrases(
        "Pay rent August 5 2026 at 9am #finance @home +admin every month 30m !high *doing",
      ),
    ).toEqual([
      "August 5 2026 at 9am",
      "#finance",
      "@home",
      "+admin",
      "every month",
      "30m",
      "!high",
      "*doing",
    ]);
  });

  it("keeps punctuation the title retains outside the phrase", async () => {
    expect(await phrases("Fix bug #work, then rest")).toEqual(["#work"]);
    expect(await phrases("Plan tomorrow's party next week")).toEqual([
      "tomorrow",
    ]);
  });

  it("never pairs letters in a consumed phrase with a later title word", async () => {
    expect(await phrases("Buy tomorrow milk")).toEqual(["tomorrow"]);
  });

  it("highlights a wikilink project as one phrase", async () => {
    expect(await phrases("+[[Big project]] call bob")).toEqual([
      "+[[Big project]]",
    ]);
  });

  it("ignores quotes that only protect literal text", async () => {
    expect(await phrases('Email "tomorrow" team today')).toEqual(["today"]);
  });

  it("returns nothing for ordinary titles and partial dates", async () => {
    expect(await phrases("Weekly review")).toEqual([]);
    expect(await phrases("Call Sam at 3p")).toEqual([]);
  });

  it("highlights everything when the whole text was consumed", async () => {
    expect(await phrases("tomorrow")).toEqual(["tomorrow"]);
  });

  it("reports trigger values for field reconciliation", async () => {
    expect(await highlights("Ship #release, +[[Big project]]")).toEqual([
      { start: 5, end: 13, kind: "tag", propertyId: "tags", value: "release" },
      {
        start: 15,
        end: 31,
        kind: "project",
        propertyId: "projects",
        value: "Big project",
      },
    ]);
  });
});

describe("reflected capture highlights", () => {
  const text = "Call Sam tomorrow #work +admin";
  const spans: CaptureHighlight[] = [
    { start: 9, end: 17, kind: "scheduled" },
    { start: 18, end: 23, kind: "tag", propertyId: "tags", value: "work" },
    {
      start: 24,
      end: 30,
      kind: "project",
      propertyId: "projects",
      value: "admin",
    },
  ];

  it("keeps phrases whose fields still hold the parsed values", () => {
    expect(
      reflectedCaptureHighlights(spans, {
        title: "Call Sam",
        scheduled: "2026-10-12",
        tags: ["work"],
        projects: ["[[admin]]"],
      }).map((span) => text.slice(span.start, span.end)),
    ).toEqual(["tomorrow", "#work", "+admin"]);
  });

  it("drops phrases removed from the interpretation", () => {
    expect(
      reflectedCaptureHighlights(spans, {
        title: "Call Sam",
        tags: [],
        projects: ["admin"],
      }).map((span) => text.slice(span.start, span.end)),
    ).toEqual(["+admin"]);
  });
});

describe("current capture highlights", () => {
  const parsed = "Call Sam tomorrow";
  const spans: CaptureHighlight[] = [{ start: 9, end: 17, kind: "scheduled" }];

  it("follows leading whitespace in the live value", () => {
    expect(
      currentCaptureHighlights(spans, parsed, "  Call Sam tomorrow"),
    ).toEqual([{ start: 11, end: 19, kind: "scheduled" }]);
  });

  it("keeps phrases while typing continues after them", () => {
    expect(
      currentCaptureHighlights(spans, parsed, "Call Sam tomorrow at"),
    ).toEqual([{ start: 9, end: 17, kind: "scheduled" }]);
  });

  it("stretches a trigger word that is still being typed", () => {
    expect(
      currentCaptureHighlights(
        [{ start: 9, end: 12, kind: "tag", propertyId: "tags", value: "wo" }],
        "Call Sam #wo",
        "Call Sam #wor",
      ),
    ).toEqual([
      { start: 9, end: 13, kind: "tag", propertyId: "tags", value: "wo" },
    ]);
  });

  it("falls back to the intact words when a phrase's last word changes", () => {
    expect(
      currentCaptureHighlights(
        [{ start: 9, end: 22, kind: "scheduled" }],
        "Call Sam tomorrow at 3",
        "Call Sam tomorrow at 3p",
      ),
    ).toEqual([{ start: 9, end: 20, kind: "scheduled" }]);
  });

  it("keeps an unchanged phrase that ends at punctuation", () => {
    expect(
      currentCaptureHighlights(
        [{ start: 9, end: 17, kind: "scheduled" }],
        "Buy milk tomorrow, then eggs",
        "Buy milk tomorrow, then eggs",
      ),
    ).toEqual([{ start: 9, end: 17, kind: "scheduled" }]);
  });

  it("drops a phrase once it is edited or extended into another word", () => {
    expect(currentCaptureHighlights(spans, parsed, "Call Sam tomorro")).toEqual(
      [],
    );
    expect(
      currentCaptureHighlights(spans, parsed, "Call Sam tomorrows"),
    ).toEqual([]);
    expect(
      currentCaptureHighlights(spans, parsed, "Call Sami tomorrow"),
    ).toEqual([]);
  });
});
