import { describe, expect, it } from "vitest";

import { expandTaskTemplate } from "./task-template";
import { TaskNotesTaskModel } from "./tasknotes-model";

describe("TaskNotes templates", () => {
  it("expands portable variables before parsing frontmatter", () => {
    const model = new TaskNotesTaskModel();
    const input = {
      title: "Ship: mobile & cloud",
      status: "open",
      priority: "high",
      due: "2026-07-25",
      scheduled: "2026-07-24T09:00:00Z",
      body: "Caller details",
      tags: ["task", "release"],
      contexts: ["computer", "office"],
      timeEstimate: 45,
      parentNote: "Projects/Mobile.md",
    };
    const task = model.create(input, {
      id: "template",
      now: "2026-07-22T03:04:05Z",
    });
    const expanded = expandTaskTemplate(
      `---
summary: {{title}}
state: {{status}}
due_day: {{dueDate}}
scheduled_day: {{scheduledDate}}
contexts_text: {{contexts}}
tags_text: {{tags}}
estimate: {{timeEstimate}}
parent: {{parentNote}}
unknown: {{futureVariable}}
---
# {{title}}

{{details}}

{{hashtags}}
`,
      task,
      input,
      {
        enabled: true,
        templatePath: "Templates/Task.md",
        failureMode: "error_abort",
        unknownVariablePolicy: "preserve",
      },
      new Date(2026, 6, 22, 13, 4, 5),
    );

    expect(expanded.frontmatter).toMatchObject({
      summary: "Ship: mobile & cloud",
      state: "open",
      due_day: "2026-07-25",
      scheduled_day: "2026-07-24",
      contexts_text: "computer, office",
      tags_text: "task, release",
      estimate: "45",
      parent: "Projects/Mobile.md",
      unknown: "{{futureVariable}}",
    });
    expect(expanded.body).toContain("# Ship: mobile & cloud");
    expect(expanded.body).toContain("Caller details");
    expect(expanded.body).toContain("#task #release");
  });

  it("merges template fields beneath explicit create values", async () => {
    const model = new TaskNotesTaskModel({
      templating: {
        enabled: true,
        templatePath: "Templates/Task.md",
        failureMode: "error_abort",
        unknownVariablePolicy: "empty",
      },
    });
    const task = await model.createWithTemplate(
      { title: "Templated", status: "open", body: "Caller body" },
      { id: "templated", now: "2026-07-22T03:04:05Z" },
      async () => `---
title: Template title
status: done
area: {{unknown}}
created_from: template
---
Template body for {{title}}`,
    );

    expect(task.title).toBe("Templated");
    expect(task.status).toBe("open");
    expect(task.frontmatter).toMatchObject({
      title: "Templated",
      status: "open",
      area: "",
      created_from: "template",
    });
    expect(task.body).toBe("Template body for Templated");
  });

  it("falls back with a warning or aborts according to configuration", async () => {
    const fallback = new TaskNotesTaskModel({
      templating: {
        enabled: true,
        templatePath: "Templates/Missing.md",
        failureMode: "warning_fallback",
        unknownVariablePolicy: "preserve",
      },
    });
    const task = await fallback.createWithTemplate(
      { title: "Fallback", body: "Caller body" },
      { id: "fallback", now: "2026-07-22T03:04:05Z" },
      async () => {
        throw new Error("template_missing: The template was not found.");
      },
    );
    expect(task.body).toBe("Caller body");
    expect(task.operationWarnings).toEqual([
      "template_missing: The template was not found.",
    ]);

    const strict = new TaskNotesTaskModel({
      ...fallback.configuration(),
      templating: {
        ...fallback.configuration().templating,
        failureMode: "error_abort",
      },
    });
    await expect(
      strict.createWithTemplate(
        { title: "Abort" },
        { id: "abort", now: "2026-07-22T03:04:05Z" },
        async () => "---\nbroken: [\n---\n",
      ),
    ).rejects.toThrow(/template_parse_failed|flow sequence/i);
  });

  it("rejects unknown variables when the collection contract requires it", () => {
    const model = new TaskNotesTaskModel();
    const input = { title: "Strict template" };
    const task = model.create(input, {
      id: "strict-template",
      now: "2026-07-22T03:04:05Z",
    });

    expect(() =>
      expandTaskTemplate("Unknown: {{futureVariable}}", task, input, {
        enabled: true,
        failureMode: "error_abort",
        unknownVariablePolicy: "error",
      }),
    ).toThrow("Unknown template variable futureVariable");
  });
});
