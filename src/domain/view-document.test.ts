import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  createViewDocument,
  readViewDraft,
  removeViewFromDocument,
  updateViewDocument,
} from "./view-document";

import type { TaskViewSourceDocument } from "./view";

describe("saved view documents", () => {
  it("edits one Obsidian view while preserving source extensions and comments", () => {
    const source = baseSource(`# keep this note
x-plugin:
  setting: retained
views:
  - type: tasknotesTaskList
    name: Inbox
    order: [status]
    x-layout: compact
  - type: tasknotesCalendar
    name: Dates
    options: { showDue: true }
`);
    const draft = readViewDraft(source, "inbox");
    const document = updateViewDocument(source, {
      ...draft,
      name: "Open work",
      properties: ["priority", "status"],
      filter: { and: ['status == "open"', 'priority == "high"'] },
    });
    const parsed = parse(document) as Record<string, unknown>;
    const first = (parsed.views as Array<Record<string, unknown>>)[0];

    expect(document).toContain("# keep this note");
    expect(parsed["x-plugin"]).toEqual({ setting: "retained" });
    expect(first["x-layout"]).toBe("compact");
    expect(first.name).toBe("Open work");
    expect(first.order).toEqual(["priority", "status"]);
  });

  it("removes only the selected view from a multi-view source", () => {
    const source = baseSource(`views:
  - { type: tasknotesTaskList, name: Inbox }
  - { type: tasknotesCalendar, name: Dates }
`);
    const removed = removeViewFromDocument(source, "inbox");
    expect(removed.deleteSource).toBe(false);
    expect(
      (parse(removed.document!) as { views: unknown[] }).views,
    ).toHaveLength(1);
    expect(
      removeViewFromDocument(
        baseSource("views: [{type: tasknotesTaskList, name: Inbox}]\n"),
        "inbox",
      ).deleteSource,
    ).toBe(true);
  });

  it("updates canonical views without changing their body or extensions", () => {
    const source: TaskViewSourceDocument = {
      path: "views/tasks.md",
      format: "mdbase.view",
      revision: "sha256:one",
      document: `---
type: view
id: task.views
version: 1
name: Task views
x-owner: { name: TaskNotes }
query: { types: [task] }
views:
  - id: all
    name: All tasks
    select: [title]
---
Keep this body.
`,
    };
    const draft = readViewDraft(source, "all");
    const updated = updateViewDocument(source, {
      ...draft,
      renderer: "tasknotes.kanban",
      groupProperty: "status",
      properties: ["title", "status"],
    });
    const parsed = parseFrontmatter(updated);
    const view = (
      parsed.frontmatter.views as Array<Record<string, unknown>>
    )[0];

    expect(parsed.body).toContain("Keep this body.");
    expect(parsed.frontmatter["x-owner"]).toEqual({ name: "TaskNotes" });
    expect(view.select).toEqual(["title", "status"]);
    expect(view.presentation).toEqual(
      expect.objectContaining({
        type: "tasknotes.kanban",
        mappings: { column: "status" },
      }),
    );

    const listDocument = updateViewDocument(
      { ...source, document: updated },
      {
        ...readViewDraft({ ...source, document: updated }, "all"),
        renderer: "tasknotes.task-list",
        filter: undefined,
      },
    );
    const listView = (
      parseFrontmatter(listDocument).frontmatter.views as Array<
        Record<string, unknown>
      >
    )[0];
    expect(listView).not.toHaveProperty("group_by");
    expect(listView).not.toHaveProperty("where");
  });

  it("creates complete source documents for both formats", () => {
    const draft = {
      id: "today",
      name: "Today",
      renderer: "tasknotes.task-list" as const,
      properties: ["title", "due"],
      options: {},
      dialect: "obsidian-bases" as const,
      availableProperties: [],
    };
    expect(
      (
        parse(createViewDocument("obsidian.base", draft)) as {
          views: unknown[];
        }
      ).views,
    ).toHaveLength(1);
    expect(
      parseFrontmatter(
        createViewDocument("mdbase.view", {
          ...draft,
          dialect: "mdbase-cel",
        }),
      ).frontmatter.type,
    ).toBe("view");
  });
});

function baseSource(document: string): TaskViewSourceDocument {
  return {
    path: "views/work.base",
    format: "obsidian.base",
    revision: "sha256:one",
    document,
  };
}
