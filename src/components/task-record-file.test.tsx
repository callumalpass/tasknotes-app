import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskRecordFile } from "./task-record-file";

const task = {
  path: "TaskNotes/Tasks/book-the-project-room.md",
  title: "Book the project room",
  frontmatter: {},
};

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("TaskRecordFile", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
  });

  it("shows the record path and copies it", async () => {
    const writeText = mockClipboard();
    render(<TaskRecordFile linkFormat="wikilink" task={task} />);
    expect(
      screen.getByRole("region", { name: "Markdown file" }),
    ).toHaveTextContent(task.path);
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Path copied"),
    );
    expect(writeText).toHaveBeenCalledWith(task.path);
  });

  it("copies a wikilink in the collection's format", async () => {
    const writeText = mockClipboard();
    render(<TaskRecordFile linkFormat="wikilink" task={task} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy wikilink" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Wikilink copied"),
    );
    expect(writeText).toHaveBeenCalledWith(
      "[[TaskNotes/Tasks/book-the-project-room|Book the project room]]",
    );
  });

  it("names Markdown links when the collection writes them", () => {
    mockClipboard();
    render(<TaskRecordFile linkFormat="markdown" task={task} />);
    expect(
      screen.getByRole("button", { name: "Copy Markdown link" }),
    ).toBeVisible();
  });

  it("says when copying fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    render(<TaskRecordFile linkFormat="wikilink" task={task} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Couldn’t copy"),
    );
  });

  it("renders nothing for a task without a record", () => {
    const { container } = render(
      <TaskRecordFile linkFormat="wikilink" task={{ ...task, path: "" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
