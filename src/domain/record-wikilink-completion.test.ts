import { describe, expect, it } from "vitest";

import {
  activeRecordWikilink,
  applyRecordWikilinkCompletion,
} from "./record-wikilink-completion";

const project = {
  kind: "record" as const,
  value: "[Project plan](/Projects/Plan.md)",
  label: "Project plan",
  detail: "Projects/Plan.md",
  path: "Projects/Plan.md",
};

describe("record wikilink completion", () => {
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
});
