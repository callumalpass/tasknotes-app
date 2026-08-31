import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { recordWikilinkCompletionSource } from "./markdown-wikilink-completion";

describe("MarkdownSourceEditor wikilink completion", () => {
  it("queries records after [[ and supplies a forced wikilink application", async () => {
    const completeRecords = vi.fn().mockResolvedValue([
      {
        kind: "record",
        value: "[Project plan](/Projects/Plan.md)",
        label: "Project plan",
        detail: "Projects/Plan.md",
        path: "Projects/Plan.md",
      },
    ]);
    const state = EditorState.create({ doc: "Review [[Pro" });
    const source = recordWikilinkCompletionSource(() => completeRecords);

    const result = await source(
      new CompletionContext(state, state.doc.length, false),
    );

    expect(completeRecords).toHaveBeenCalledWith({
      field: "wikilink",
      kind: "records",
      query: "Pro",
      limit: 12,
    });
    expect(result).toMatchObject({ from: 7, to: 12, filter: false });
    expect(result?.options).toEqual([
      expect.objectContaining({
        label: "Project plan",
        detail: "Projects/Plan.md",
        apply: "[[Projects/Plan|Project plan]]",
      }),
    ]);
  });

  it("stays closed outside an active wikilink and tolerates provider failure", async () => {
    const completeRecords = vi.fn().mockRejectedValue(new Error("offline"));
    const source = recordWikilinkCompletionSource(() => completeRecords);

    await expect(
      source(
        new CompletionContext(EditorState.create({ doc: "Plain" }), 5, false),
      ),
    ).resolves.toBeNull();
    await expect(
      source(
        new CompletionContext(EditorState.create({ doc: "[[Pro" }), 5, false),
      ),
    ).resolves.toBeNull();
  });
});
