import { describe, expect, it } from "vitest";

import { TaskNotesTaskModel } from "./tasknotes-model";
import { emptyViewDraft } from "./view-document";
import { previewViewDraft } from "./view-preview";

describe("previewViewDraft", () => {
  it("evaluates an unsaved Bases filter against collection tasks", () => {
    const model = new TaskNotesTaskModel();
    const tasks = [
      model.create(
        { title: "Open task", status: "open" },
        { id: "open", now: "2026-08-07T00:00:00Z" },
      ),
      model.create(
        { title: "Finished task", status: "open" },
        { id: "done", now: "2026-08-07T00:00:00Z" },
      ),
    ];
    const draft = {
      ...emptyViewDraft("obsidian-bases"),
      filter: 'note["title"] == "Finished task"',
    };

    expect(previewViewDraft(draft, tasks)).toEqual({
      kind: "live",
      count: 1,
      tasks: [tasks[1]],
    });
  });

  it("does not claim a live result for CEL drafts", () => {
    expect(previewViewDraft(emptyViewDraft("mdbase-cel"), [])).toEqual({
      kind: "unavailable",
      tasks: [],
    });
  });

  it("sorts demo results by computed properties", () => {
    const model = new TaskNotesTaskModel();
    const tasks = [
      model.create({ title: "Alpha" }, { id: "alpha" }),
      model.create({ title: "Zulu" }, { id: "zulu" }),
    ];
    const draft = {
      ...emptyViewDraft("obsidian-bases"),
      computedProperties: [
        { name: "label", expression: "note.title", scope: "source" as const },
      ],
      sort: [{ property: "formula.label", direction: "desc" as const }],
    };

    expect(
      previewViewDraft(draft, tasks).tasks.map(({ title }) => title),
    ).toEqual(["Zulu", "Alpha"]);
  });
});
