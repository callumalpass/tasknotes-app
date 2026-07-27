import { describe, expect, it } from "vitest";

import { normalizeViewDocuments, normalizeViewExecution } from "./views";

import type { TaskView } from "../domain/view";
import type { ProviderViewExecution } from "./views";

describe("provider view documents", () => {
  it("preserves source grouping and named-view order", () => {
    const source = {
      path: "views/work.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    };
    const documents = normalizeViewDocuments({
      views: [
        {
          id: "work",
          name: "Work",
          source,
          views: [
            { id: "today", name: "Today" },
            { id: "board", name: "Board" },
          ],
        },
      ],
    });

    expect(documents).toHaveLength(1);
    expect(documents[0].views.map((view) => view.name)).toEqual([
      "Today",
      "Board",
    ]);
    expect(documents[0].views[1]).toMatchObject({
      key: "views/work.base#board",
      documentId: "work",
      documentName: "Work",
    });
  });

  it("normalizes TaskNotes renderer aliases at the application boundary", () => {
    const source = {
      path: "views/work.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    };
    const [document] = normalizeViewDocuments({
      views: [
        {
          id: "work",
          name: "Work",
          source,
          views: [
            {
              id: "board",
              name: "Board",
              presentation: { type: "tasknotesKanban" },
            },
            {
              id: "custom",
              name: "Custom",
              presentation: { type: "exampleCustomRenderer" },
            },
          ],
        },
      ],
    });

    expect(document.views[0].presentation?.type).toBe("tasknotes.kanban");
    expect(document.views[1].presentation?.type).toBe("exampleCustomRenderer");
  });

  it("normalizes provider manual sort metadata from canonical fields", () => {
    const source = {
      path: "views/work.md",
      format: "mdbase.view",
      revision: "one",
      writable: true,
    };
    const [document] = normalizeViewDocuments({
      views: [
        {
          id: "work",
          name: "Work",
          source,
          views: [
            {
              id: "manual",
              name: "Manual",
              order_by: [
                {
                  field: "tasknotes_manual_order",
                  direction: "desc",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(document.views[0].sort).toEqual([
      { property: "tasknotes_manual_order", direction: "desc" },
    ]);
  });

  it("infers a kanban column role from generic execution groups", () => {
    const view: TaskView = {
      key: "views/work.base#board",
      documentId: "work",
      documentName: "Work",
      id: "board",
      name: "Board",
      properties: [],
      source: {
        path: "views/work.base",
        format: "obsidian.base",
        revision: "one",
        writable: true,
      },
      presentation: {
        type: "tasknotes.kanban",
        mappings: {},
        options: {},
      },
    };

    const execution = normalizeViewExecution(
      view,
      {
        results: [],
        meta: {
          total_count: 2,
          has_more: false,
          groups: [
            {
              values: { project: "mdbase" },
              count: 2,
              summaries: {},
            },
          ],
        },
      },
      () => null,
    );

    expect(execution.view.presentation?.mappings.column).toBe("project");
    expect(view.presentation?.mappings).toEqual({});
  });

  it("uses canonical effective frontmatter for saved-view records", () => {
    const view: TaskView = {
      key: "views/work.base#list",
      documentId: "work",
      documentName: "Work",
      id: "list",
      name: "List",
      properties: [],
      source: {
        path: "views/work.base",
        format: "obsidian.base",
        revision: "one",
        writable: true,
      },
    };

    const execution = normalizeViewExecution(
      view,
      {
        results: [
          {
            path: "tasks/canonical.md",
            effective_frontmatter: { title: "Canonical title" },
            types: ["task"],
          },
        ],
        meta: { total_count: 1, has_more: false },
      },
      () => null,
    );

    expect(execution.records?.[0].record).toMatchObject({
      label: "Canonical title",
      frontmatter: { title: "Canonical title" },
    });
  });

  it("keeps body-only saved-view records with empty effective frontmatter", () => {
    const view: TaskView = {
      key: "views/work.base#all",
      documentId: "work",
      documentName: "Work",
      id: "all",
      name: "All documents",
      properties: [],
      source: {
        path: "views/work.base",
        format: "obsidian.base",
        revision: "one",
        writable: true,
      },
    };

    const execution = normalizeViewExecution(
      view,
      {
        results: [
          {
            path: "notes/body-only.md",
            effective_frontmatter: {},
            body: "# Body only",
            types: [],
          },
        ],
        meta: { total_count: 1, has_more: false },
      },
      () => null,
    );

    expect(execution.records?.[0].record).toEqual({
      path: "notes/body-only.md",
      label: "body-only",
      frontmatter: {},
      body: "# Body only",
      types: [],
    });
  });

  it("rejects saved-view records that omit effective frontmatter", () => {
    const view: TaskView = {
      key: "views/work.base#all",
      documentId: "work",
      documentName: "Work",
      id: "all",
      name: "All documents",
      properties: [],
      source: {
        path: "views/work.base",
        format: "obsidian.base",
        revision: "one",
        writable: true,
      },
    };
    const malformed = {
      results: [{ path: "notes/malformed.md", body: "# Missing projection" }],
      meta: { total_count: 1, has_more: false },
    } as unknown as ProviderViewExecution;

    expect(() => normalizeViewExecution(view, malformed, () => null)).toThrow(
      'Invalid saved-view record "notes/malformed.md": effective_frontmatter must be an object.',
    );
  });
});
