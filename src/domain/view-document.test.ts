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
  it("round-trips the TaskNotes Planner Base renderer", () => {
    const source = baseSource(`views:
  - type: tasknotesPlanner
    name: Launch plan
    options: { zoom: 4, showCompleted: false }
`);
    const draft = readViewDraft(source, "launch-plan");
    expect(draft.renderer).toBe("tasknotes.planner");
    const document = updateViewDocument(source, {
      ...draft,
      options: { ...draft.options, zoom: 5 },
    });
    expect(
      (parse(document) as { views: Array<Record<string, unknown>> }).views[0],
    ).toMatchObject({
      type: "tasknotesPlanner",
      options: { zoom: 5, showCompleted: false },
    });
  });

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
    presentation:
      type: tasknotes.task-list
      x-density: compact
      mappings: { owner: project }
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
        "x-density": "compact",
        mappings: { owner: "project", column: "status" },
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
    expect(listView.group_by).toEqual([{ field: "status", direction: "asc" }]);
    expect(listView.presentation).toEqual(
      expect.objectContaining({
        "x-density": "compact",
        mappings: { owner: "project" },
      }),
    );
    expect(listView).not.toHaveProperty("where");
  });

  it("creates complete source documents for both formats", () => {
    const draft = {
      id: "today",
      name: "Today",
      renderer: "tasknotes.task-list" as const,
      computedProperties: [],
      properties: ["title", "due"],
      sort: [],
      groupDirection: "asc" as const,
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

  it("preserves grouping for list views", () => {
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: By status
    groupBy:
      property: status
      direction: ASC
`);
    const draft = readViewDraft(source, "by-status");
    expect(draft.groupProperty).toBe("status");
    expect(draft.groupDirection).toBe("asc");
    const updated = parse(
      updateViewDocument(source, {
        ...draft,
        groupProperty: "priority",
        groupDirection: "desc",
      }),
    ) as { views: Array<Record<string, unknown>> };
    expect(updated.views[0].groupBy).toEqual({
      property: "priority",
      direction: "DESC",
    });
  });

  it("round-trips sorting in both view dialects", () => {
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: Ranked
    sort:
      - { property: priority, direction: DESC }
      - { property: due, direction: ASC }
`);
    const draft = readViewDraft(source, "ranked");
    expect(draft.sort).toEqual([
      { property: "priority", direction: "desc" },
      { property: "due", direction: "asc" },
    ]);
    const updated = parse(
      updateViewDocument(source, {
        ...draft,
        sort: [{ property: "title", direction: "asc" }],
      }),
    ) as { views: Array<Record<string, unknown>> };
    expect(updated.views[0].sort).toEqual([
      { property: "title", direction: "ASC" },
    ]);

    const canonical = createViewDocument("mdbase.view", {
      ...draft,
      dialect: "mdbase-cel",
      sort: [{ property: "due", direction: "desc" }],
    });
    const canonicalDraft = readViewDraft(
      {
        path: "views/ranked.md",
        format: "mdbase.view",
        revision: "sha256:two",
        document: canonical,
      },
      "ranked",
    );
    expect(canonicalDraft.sort).toEqual([
      { property: "due", direction: "desc" },
    ]);
  });

  it("edits Obsidian formulas and exposes them to the rest of the view", () => {
    const source = baseSource(`formulas:
  score: 'if(priority == "high", 2, 1)'
properties:
  formula.score: { displayName: Score }
views:
  - type: tasknotesTaskList
    name: Ranked
    filters: formula.score > 1
    order: [title, formula.score]
`);
    const draft = readViewDraft(source, "ranked");
    expect(draft.computedProperties).toEqual([
      {
        name: "score",
        expression: 'if(priority == "high", 2, 1)',
        scope: "source",
        originalName: "score",
      },
    ]);
    expect(draft.availableProperties).toContain("formula.score");

    const updated = parse(
      updateViewDocument(source, {
        ...draft,
        computedProperties: [
          {
            ...draft.computedProperties[0],
            expression: 'if(priority == "high", 3, 1)',
          },
          {
            name: "label",
            expression: 'if(formula.score > 1, "urgent", "normal")',
            scope: "source",
          },
        ],
        properties: ["title", "formula.label"],
      }),
    ) as Record<string, unknown>;

    expect(updated.formulas).toEqual({
      score: 'if(priority == "high", 3, 1)',
      label: 'if(formula.score > 1, "urgent", "normal")',
    });
    expect(updated.properties).toEqual({
      "formula.score": { displayName: "Score" },
    });
    expect((updated.views as Array<Record<string, unknown>>)[0].order).toEqual([
      "title",
      "formula.label",
    ]);
  });

  it("preserves canonical projection scope and extension data", () => {
    const source: TaskViewSourceDocument = {
      path: "views/ranked.md",
      format: "mdbase.view",
      revision: "sha256:ranked",
      document: `---
type: view
id: ranked
version: 1
name: Ranked
query:
  types: [task]
  projections:
    score:
      expr: 'priority == "high" ? 2 : 1'
      description: Shared score
      x-owner: tasknotes
views:
  - id: ranked
    name: Ranked
    projections:
      label:
        expr: 'string(projection.score)'
        description: View label
    where: projection.score > 1
    select: [title, projection.label]
    presentation: { type: tasknotes.task-list }
---
`,
    };
    const draft = readViewDraft(source, "ranked");
    expect(draft.computedProperties).toEqual([
      {
        name: "score",
        expression: 'priority == "high" ? 2 : 1',
        scope: "source",
        originalName: "score",
        originalDefinition: {
          expr: 'priority == "high" ? 2 : 1',
          description: "Shared score",
          "x-owner": "tasknotes",
        },
      },
      {
        name: "label",
        expression: "string(projection.score)",
        scope: "view",
        originalName: "label",
        originalDefinition: {
          expr: "string(projection.score)",
          description: "View label",
        },
      },
    ]);

    const updated = parseFrontmatter(
      updateViewDocument(source, {
        ...draft,
        computedProperties: draft.computedProperties.map((property) =>
          property.name === "label"
            ? { ...property, name: "display_label", scope: "source" }
            : property,
        ),
      }),
    ).frontmatter;
    const query = updated.query as Record<string, unknown>;
    const projections = query.projections as Record<
      string,
      Record<string, unknown>
    >;
    const view = (updated.views as Array<Record<string, unknown>>)[0];

    expect(projections.score).toEqual({
      expr: 'priority == "high" ? 2 : 1',
      description: "Shared score",
      "x-owner": "tasknotes",
    });
    expect(projections.display_label).toEqual({
      expr: "string(projection.score)",
      description: "View label",
    });
    expect(view).not.toHaveProperty("projections");
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
