import { Fragment, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "../../test/render";
import type { TaskViewRow } from "../../domain/view";
import { VirtualTaskList } from "./virtual-task-list";

vi.mock("../../components/bounded-list", () => ({
  BoundedList: ({
    items,
    renderItem,
  }: {
    items: { key: string }[];
    renderItem(entry: { key: string }): ReactNode;
  }) =>
    items.map((entry) => (
      <Fragment key={entry.key}>{renderItem(entry)}</Fragment>
    )),
}));

it("opens collapsed virtual lanes while arranging and retains empty-target feedback", () => {
  const row: TaskViewRow = {
    task: {
      id: "dated",
      path: "tasks/dated.md",
      title: "Dated task",
      status: "open",
      completed: false,
      archived: false,
      priority: "normal",
      createdAt: "2026-11-07",
      updatedAt: "2026-11-07",
      tags: [],
      contexts: [],
      projects: [],
      attachments: [],
      blockedBy: [],
      completeInstances: [],
      skippedInstances: [],
      reminders: [],
      timeEntries: [],
      customProperties: {},
      revision: 1,
      frontmatter: {},
    },
    values: {},
  };
  const preference = "tasknotes:section:virtual-drag:today";
  localStorage.setItem(preference, "collapsed");
  const props = {
    selectionEnabled: false,
    lanes: [
      { key: "today", label: "Today", rows: [row] },
      {
        key: "tomorrow",
        label: "Tomorrow",
        rows: [],
        className: "is-drop-target",
      },
    ],
    grouped: true,
    daySections: false,
    preferenceScope: "virtual-drag",
    properties: [],
    titleProperty: "note.title",
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    renderRow: (entry: TaskViewRow) => (
      <p key={entry.task.id}>{entry.task.title}</p>
    ),
    showEmpty: true,
  };
  try {
    const { rerender } = render(<VirtualTaskList {...props} />);
    expect(screen.queryByText("Dated task")).toBeNull();
    rerender(<VirtualTaskList {...props} arranging />);
    expect(screen.getByText("Dated task")).toBeVisible();
    const target = screen.getByRole("button", { name: "Tomorrow 0" });
    expect(target).toHaveAttribute("aria-expanded", "true");
    expect(target).toBeDisabled();
    expect(target.closest("section")).toHaveClass("is-drop-target");
    expect(localStorage.getItem(preference)).toBe("collapsed");
  } finally {
    localStorage.removeItem(preference);
  }
});
