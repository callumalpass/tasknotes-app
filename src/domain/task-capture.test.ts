import { describe, expect, it } from "vitest";

import { todayString } from "./task";
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

describe("task capture", () => {
  it("maps natural language into a complete creation input", async () => {
    const result = await parseTaskCapture(
      "Pay rent August 5 2026 at 9am #finance @home +admin every month 30m !high *doing",
      configuration,
      "en-AU",
    );

    expect(result.input).toMatchObject({
      title: "Pay rent",
      scheduled: "2026-08-05T09:00",
      tags: ["finance"],
      contexts: ["home"],
      projects: ["admin"],
      recurrence: "FREQ=MONTHLY",
      timeEstimate: 30,
      priority: "high",
      status: "doing",
    });
    expect(result.preview.map((item) => item.key)).toEqual([
      "scheduled",
      "status",
      "priority",
      "recurrence",
      "estimate",
      "project:admin",
      "context:home",
      "tag:finance",
    ]);
  });

  it("preserves wikilinks and maps due dates separately", async () => {
    const result = await parseTaskCapture(
      "Review [[Project Alpha]] due August 6 2026 2pm",
      configuration,
      "en-AU",
    );

    expect(result.input).toMatchObject({
      title: "Review [[Project Alpha]]",
      due: "2026-08-06T14:00",
    });
  });

  it("leaves ordinary titles untouched", async () => {
    const result = await parseTaskCapture(
      "Call the electrician",
      configuration,
      "en-AU",
    );
    expect(result).toEqual({
      input: { title: "Call the electrician" },
      preview: [],
    });
  });

  it("does not mistake frequency adjectives for recurrence commands", async () => {
    const result = await parseTaskCapture(
      "Prepare weekly review",
      configuration,
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Prepare weekly review" });
  });

  it("keeps hyphenated frequency words without inserting escape characters", async () => {
    for (const token of [
      "due-only-weekly",
      "weekly-review",
      "daily-check",
      "monthly-report",
      "yearly-plan",
      "annually-renew",
    ]) {
      for (const suffix of ["", " probe", " every week"]) {
        const title = `[test] ${token}${suffix}`;
        const result = await parseTaskCapture(title, configuration, "en-AU");
        expect(result.input).toEqual(
          suffix === " every week"
            ? { title: `[test] ${token}`, recurrence: "FREQ=WEEKLY" }
            : { title },
        );
      }
    }
  });

  it("uses configured triggers", async () => {
    const result = await parseTaskCapture(
      "Tidy desk ~home",
      {
        ...configuration,
        nlp: {
          triggers: [{ propertyId: "contexts", trigger: "~", enabled: true }],
        },
      },
      "en-AU",
    );

    expect(result.input).toMatchObject({
      title: "Tidy desk",
      contexts: ["home"],
    });
  });
});

describe("ranked priority shorthand", () => {
  it.each([
    ["p1", "high"],
    ["p2", "normal"],
    ["p3", "normal"],
    ["p4", "normal"],
  ])(
    "maps %s by weight and clamps to the available priorities",
    async (token, priority) => {
      const result = await parseTaskCapture(
        `Call Rowan ${token}`,
        configuration,
        "en-AU",
      );
      expect(result.input).toEqual({ title: "Call Rowan", priority });
      expect(result.highlights).toContainEqual({
        start: 11,
        end: 13,
        kind: "priority",
      });
    },
  );

  it("ranks by weight rather than collection order and uses the last shorthand", async () => {
    const result = await parseTaskCapture(
      "p4 Call Rowan p1",
      {
        ...configuration,
        priorities: [
          {
            id: "a",
            value: "middle",
            label: "Middle",
            weight: 20,
            color: "#112233",
          },
          {
            id: "b",
            value: "highest",
            label: "Highest",
            weight: 90,
            color: "#334455",
          },
          {
            id: "c",
            value: "lowest",
            label: "Lowest",
            weight: -5,
            color: "#556677",
          },
        ],
      },
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Call Rowan", priority: "highest" });
  });

  it("recognizes uppercase shorthand and trailing punctuation", async () => {
    const result = await parseTaskCapture(
      "Call Rowan P1, tomorrow",
      configuration,
      "en-AU",
    );
    expect(result.input.title).toBe("Call Rowan");
    expect(result.input.priority).toBe("high");
    expect(result.input.scheduled).toBeDefined();
    expect(result.highlights).toContainEqual({
      start: 11,
      end: 14,
      kind: "priority",
    });
  });

  it("keeps date and shorthand highlights disjoint when priority separates date and time", async () => {
    const text = "Call Rowan tomorrow p1 3pm";
    const result = await parseTaskCapture(text, configuration, "en-AU");
    expect(result.input.title).toBe("Call Rowan");
    expect(result.input.priority).toBe("high");
    expect(result.input.scheduled).toMatch(/T15:00$/);
    const highlights = result.highlights!;
    expect(highlights.map(({ start, end }) => text.slice(start, end))).toEqual([
      "tomorrow",
      "p1",
      "3pm",
    ]);
    for (let index = 1; index < highlights.length; index++) {
      expect(highlights[index].start).toBeGreaterThanOrEqual(
        highlights[index - 1].end,
      );
    }
  });

  it("retains the date, time, recurrence and other tokens", async () => {
    const result = await parseTaskCapture(
      "Call Rowan August 5 2026 3pm #work every week p1",
      configuration,
      "en-AU",
    );
    expect(result.input).toEqual({
      title: "Call Rowan",
      scheduled: "2026-08-05T15:00",
      tags: ["work"],
      recurrence: "FREQ=WEEKLY",
      priority: "high",
    });
    expect(
      result.highlights?.map(({ start, end }) =>
        "Call Rowan August 5 2026 3pm #work every week p1".slice(start, end),
      ),
    ).toContain("p1");
  });

  it.each([
    "p10",
    "ap1",
    "p1code",
    "p1-file",
    "#p1",
    "@p1",
    "+p1",
    "[[Spec p1 notes]]",
    "[Spec p1 notes](spec.md)",
  ])("does not consume %s as shorthand", async (token) => {
    const result = await parseTaskCapture(
      `Review ${token}`,
      configuration,
      "en-AU",
    );
    expect(result.input.priority).toBeUndefined();
    expect(
      result.highlights?.filter((highlight) => highlight.kind === "priority") ??
        [],
    ).toEqual([]);
  });

  it("keeps an explicit named priority", async () => {
    const result = await parseTaskCapture(
      "Call Rowan p1 !normal",
      configuration,
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Call Rowan", priority: "normal" });
  });

  it("leaves shorthand in the title when no priorities exist", async () => {
    const result = await parseTaskCapture(
      "Call Rowan p1",
      { ...configuration, priorities: [] },
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Call Rowan p1" });
  });

  it("maps all shorthand to the sole configured priority", async () => {
    const result = await parseTaskCapture(
      "Call Rowan p4",
      { ...configuration, priorities: configuration.priorities.slice(1) },
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Call Rowan", priority: "high" });
  });
});

it("reaches every rank of a long priority list", async () => {
  const priorities = Array.from({ length: 7 }, (_, index) => ({
    id: `rank-${index}`,
    value: `rank-${index}`,
    label: `Rank ${index}`,
    color: "#336699",
    weight: index,
  }));
  const long = { ...configuration, priorities };
  const { input } = await parseTaskCapture("Call Rowan p6", long, "en-AU");
  expect(input).toEqual(
    expect.objectContaining({ title: "Call Rowan", priority: "rank-1" }),
  );
  const beyond = await parseTaskCapture("Call Rowan p8", long, "en-AU");
  expect(beyond.input.title).toBe("Call Rowan p8");
});

describe("day parts in a title", () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const tomorrow = todayString(next);

  it.each([
    ["Morning appointment tomorrow 9am", "Morning appointment", "T09:00"],
    ["Afternoon tea tomorrow 3pm", "Afternoon tea", "T15:00"],
    ["Book night shift tomorrow 9am", "Book night shift", "T09:00"],
  ])(
    "keeps %s as the title and honours its time",
    async (text, title, time) => {
      const { input } = await parseTaskCapture(text, configuration, "en-AU");
      expect(input.title).toBe(title);
      expect(input.scheduled).toContain(`${tomorrow}${time}`);
    },
  );

  it("does not schedule a task only because its title has a day part", async () => {
    const { input } = await parseTaskCapture(
      "Morning run",
      configuration,
      "en-AU",
    );
    expect(input).toEqual(expect.objectContaining({ title: "Morning run" }));
    expect(input.scheduled).toBeUndefined();
  });

  it("still reads a day part that follows a date", async () => {
    const { input } = await parseTaskCapture(
      "Call Rowan tomorrow morning",
      configuration,
      "en-AU",
    );
    expect(input.title).toBe("Call Rowan");
    expect(input.scheduled).toContain(tomorrow);
  });
});

describe("known projects with spaces", () => {
  it("keeps a project name whole without link markup", async () => {
    const { input, highlights } = await parseTaskCapture(
      "Call dentist tomorrow 9am +Product refresh #health",
      configuration,
      "en",
      ["Product refresh", "Operations"],
    );
    expect(input.title).toBe("Call dentist");
    expect(input.projects).toEqual(["Product refresh"]);
    expect(highlights?.find(({ kind }) => kind === "project")).toMatchObject({
      start: 26,
      end: 42,
    });
  });

  it("leaves a word that only begins like a project", async () => {
    const { input } = await parseTaskCapture(
      "Plan +Product refreshments",
      configuration,
      "en",
      ["Product refresh"],
    );
    expect(input.projects).toEqual(["Product"]);
  });
});
