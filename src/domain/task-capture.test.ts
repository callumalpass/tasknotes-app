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

describe("priority in capture", () => {
  it("does not read part of a chosen multi-word name as another choice", async () => {
    const wordy = resolveTaskCollectionConfiguration({
      name: "task",
      schema: {
        value: {
          type: "object",
          properties: {
            title: { type: "string", tn_role: "title" },
            priority: {
              type: "string",
              tn_role: "priority",
              enum: ["high", "very-high"],
            },
          },
        },
      },
      implements: [
        {
          contract: "tasknotes.task",
          version: "0.3.0-rc.5",
          fields: { title: "title", priority: "priority" },
          binding: {
            priority: {
              definitions: [
                { value: "high", label: "High", order: 0 },
                { value: "very-high", label: "Very high", order: 1 },
              ],
            },
          },
        },
      ],
    } as never);
    const parsed = (text: string) => parseTaskCapture(text, wordy, "en-AU");
    for (const text of ["Call Rowan !very-high", "Call Rowan !Very high"]) {
      const result = await parsed(text);
      expect(result.input).toEqual({
        title: "Call Rowan",
        priority: "very-high",
      });
    }
  });

  it("leaves p1 in the title", async () => {
    const result = await parseTaskCapture(
      "Call Rowan p1",
      configuration,
      "en-AU",
    );
    expect(result.input).toEqual({ title: "Call Rowan p1" });
  });

  it("keeps date and priority highlights apart when priority separates date and time", async () => {
    const text = "Call Rowan tomorrow !high 3pm";
    const result = await parseTaskCapture(text, configuration, "en-AU");
    expect(result.input.priority).toBe("high");
    expect(result.highlights!.map(({ kind }) => kind)).toContain("priority");
  });
});

describe("status and priority words in a title", () => {
  it.each([
    ["Doing the dishes on Monday", "Doing the dishes", undefined],
    ["Zebra doing check", "Zebra doing check", undefined],
    ["Send high five to Rowan", "Send high five to Rowan", undefined],
  ])("keeps %s as written", async (text, title, priority) => {
    const { input } = await parseTaskCapture(text, configuration, "en-AU");
    expect(input.title).toBe(title);
    expect(input.status).toBeUndefined();
    expect(input.priority).toBe(priority);
  });

  it("still reads marked values", async () => {
    const { input } = await parseTaskCapture(
      "Call Rowan !high *doing",
      configuration,
      "en-AU",
    );
    expect(input).toEqual(
      expect.objectContaining({
        title: "Call Rowan",
        priority: "high",
        status: "doing",
      }),
    );
  });
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

describe("a day of the month", () => {
  it.each(["Pay bills every 1st", "Pay bills every month on the 1st"])(
    "repeats %s and leaves it out of the title",
    async (text) => {
      const { input } = await parseTaskCapture(text, configuration, "en");
      expect(input.title).toBe("Pay bills");
      expect(input.recurrence).toContain("FREQ=MONTHLY;BYMONTHDAY=1");
      expect(input.scheduled?.slice(8, 10)).toBe("01");
    },
  );
});
