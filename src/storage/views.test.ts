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
              id: "planner",
              name: "Planner",
              presentation: { type: "tasknotesPlanner" },
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
    expect(document.views[1].presentation?.type).toBe("tasknotes.planner");
    expect(document.views[2].presentation?.type).toBe("exampleCustomRenderer");
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
          totalCount: 2,
          hasMore: false,
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
            effectiveFrontmatter: { title: "Canonical title" },
            types: ["task"],
          },
        ],
        meta: { totalCount: 1, hasMore: false },
      },
      () => null,
    );

    expect(execution.records?.[0].record).toMatchObject({
      label: "Canonical title",
      frontmatter: { title: "Canonical title" },
    });
  });

  it("preserves a nonfatal skipped-record signal from provider diagnostics", () => {
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
        results: [],
        meta: { totalCount: 0, hasMore: false },
        diagnostics: [
          {
            severity: "warning",
            code: "hosted_base_record_skipped",
            message: "A record was omitted.",
          },
        ],
      },
      () => null,
    );

    expect(execution.hasSkippedRecords).toBe(true);
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
            effectiveFrontmatter: {},
            body: "# Body only",
            types: [],
          },
        ],
        meta: { totalCount: 1, hasMore: false },
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
      meta: { totalCount: 1, hasMore: false },
    } as unknown as ProviderViewExecution;

    expect(() => normalizeViewExecution(view, malformed, () => null)).toThrow(
      'Invalid saved-view record "notes/malformed.md": effectiveFrontmatter must be an object.',
    );
  });
});
