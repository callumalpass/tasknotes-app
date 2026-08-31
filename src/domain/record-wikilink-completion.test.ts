import { describe, expect, it } from "vitest";

import {
  activeRecordWikilink,
  applyRecordWikilinkCompletion,
  recordWikilinkCompletionRequest,
} from "./record-wikilink-completion";

const project = {
  kind: "record" as const,
  value: "[Project plan](/Projects/Plan.md)",
  label: "Project plan",
  detail: "Projects/Plan.md",
  path: "Projects/Plan.md",
};

describe("record wikilink completion", () => {
  it("detects an explicit opener and builds a provider-neutral request", () => {
    const token = activeRecordWikilink("Review [[Project pl", 19)!;

    expect(token).toEqual({ from: 7, to: 19, query: "Project pl" });
    expect(recordWikilinkCompletionRequest(token)).toEqual({
      field: "wikilink",
      kind: "records",
      query: "Project pl",
      limit: 12,
    });
  });

  it("replaces an unfinished or already-closed token with a forced wikilink", () => {
    const unfinished = activeRecordWikilink("Review [[Pro today", 12)!;
    expect(
      applyRecordWikilinkCompletion("Review [[Pro today", unfinished, project),
    ).toEqual({
      text: "Review [[Projects/Plan|Project plan]] today",
      cursor: 37,
    });

    const closed = activeRecordWikilink("[[Pro]] later", 5)!;
    expect(
      applyRecordWikilinkCompletion("[[Pro]] later", closed, project),
    ).toEqual({
      text: "[[Projects/Plan|Project plan]] later",
      cursor: 30,
    });
  });

  it.each([
    ["Complete [[Project]]", 20],
    ["Escaped \\[[Project", 19],
    ["Alias [[Project|label", 21],
    ["Previous [[Done]] and text", 26],
    ["First line [[open\nnext", 23],
  ])("does not activate for non-active text: %s", (text, cursor) => {
    expect(activeRecordWikilink(text, cursor)).toBeUndefined();
  });

  it("ignores value-only completions", () => {
    const token = activeRecordWikilink("[[", 2)!;
    expect(
      applyRecordWikilinkCompletion("[[", token, {
        kind: "value",
        value: "project",
        label: "Project",
      }),
    ).toBeUndefined();
  });
});
