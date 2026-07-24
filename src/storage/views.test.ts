import { describe, expect, it } from "vitest";

import { normalizeViewDocuments, normalizeViewExecution } from "./views";

import type { TaskView } from "../domain/view";

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
});
