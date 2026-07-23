import { describe, expect, it } from "vitest";

import { normalizeViewDocuments } from "./views";

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
});
