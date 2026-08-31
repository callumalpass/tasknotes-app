import { describe, expect, it } from "vitest";

import { assertPersistableMarkdownWikilinks } from "./markdown-validation";

describe("temporary Markdown wikilink guard", () => {
  it.each([
    "A normal note",
    "A complete [[Plan]]",
    "An aliased [[Projects/Plan|Plan]]",
    "An embedded ![[Attachments/plan.png]]",
    "Several [[First]] and [[Second|two]] links",
    "A fragment [[#Next steps]]",
    "An escaped \\[[literal opening",
    "Inline code: `[[not a link` and ``[[also literal``",
    "```md\n[[unfinished example\n```\nA complete [[Plan]]",
    "```md\n```not-a-close\n[[unfinished example\n```\nA complete [[Plan]]",
    "`A multiline code span\n[[unfinished example\ncontinues here`",
    "    [[unfinished indented example",
  ])("allows persistable Markdown: %s", (markdown) => {
    expect(() => assertPersistableMarkdownWikilinks(markdown)).not.toThrow();
  });

  it.each([
    "[[]]",
    "![[ ]]",
    "[[|Empty target]]",
    "Start [[Plan",
    "Start [[Plan]",
    "A [[nested [[Plan]] link",
    "A complete [[Plan]] then [[unfinished",
    "Draft [[Plan\nAn array access closes later: values[x]]",
    "A strikethrough ~~[[unfinished~~ is still unsafe",
    "```bad` [[unfinished",
  ])("blocks unsafe Markdown before it reaches Connect: %s", (markdown) => {
    expect(() => assertPersistableMarkdownWikilinks(markdown)).toThrow(
      "Finish or remove the empty or incomplete wikilink before saving",
    );
  });
});
