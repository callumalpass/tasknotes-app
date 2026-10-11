import { describe, expect, it } from "vitest";

import { taskRecordLink } from "./task-links";

const task = {
  path: "TaskNotes/Tasks/send-the-research-summary.md",
  title: "Send the research summary",
  frontmatter: {},
};

describe("taskRecordLink", () => {
  it("writes an extensionless wikilink aliased with the title", () => {
    expect(taskRecordLink(task, "wikilink")).toBe(
      "[[TaskNotes/Tasks/send-the-research-summary|Send the research summary]]",
    );
  });

  it("omits the alias when the title matches the file name", () => {
    expect(
      taskRecordLink(
        { ...task, path: "Tasks/Inbox zero.md", title: "Inbox zero" },
        "wikilink",
      ),
    ).toBe("[[Tasks/Inbox zero]]");
  });

  it("follows a collection that writes Markdown links", () => {
    expect(taskRecordLink(task, "markdown")).toBe(
      "[Send the research summary](/TaskNotes/Tasks/send-the-research-summary.md)",
    );
  });

  it("returns nothing for a task without a record", () => {
    expect(taskRecordLink({ ...task, path: "" }, "wikilink")).toBe("");
  });
});
