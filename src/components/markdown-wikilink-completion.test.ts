import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { recordWikilinkCompletionSource } from "./markdown-wikilink-completion";

describe("MarkdownSourceEditor wikilink completion", () => {
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
