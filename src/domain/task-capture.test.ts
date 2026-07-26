import { describe, expect, it } from "vitest";

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
  "x-tasknotes": {
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
