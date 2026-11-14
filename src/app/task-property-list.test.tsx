import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/render";
import { RepositoryProvider } from "./repository-context";
import { TaskPropertyList } from "./task-property-list";
import { toDraft, type Draft } from "./task-editor-draft";
import { todayString, type Task } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import type { NextTaskRepository } from "../storage/next-repository";

describe("TaskPropertyList", () => {
  let repository: NextTaskRepository;
  let task: Task;
  afterEach(() => {
    vi.unstubAllGlobals();
    repository.dispose();
  });
  beforeEach(async () => {
    ({ repository } = await nextTaskFixture());
    await repository.initialize();
    task = await repository.create({ title: "Plan the week" });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  function renderList(patch: Partial<Draft> = {}) {
    const onChange = vi.fn();
    render(
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <TaskPropertyList
          task={task}
          draft={{ ...toDraft(task), ...patch }}
          configuration={defaultTaskCollectionConfiguration()}
          projectLabels={new Map()}
          relationships={{
            blockedBy: [],
            blocking: [],
            subtasks: [],
            projectTasks: [],
          }}
          occurrenceNote={false}
          seriesDates={false}
          completeField={async () => []}
          completeDependencyField={async () => []}
          time={{
            busy: false,
            error: null,
            onStart: vi.fn(),
            onStop: vi.fn(),
            onReplace: vi.fn(),
            onRemove: vi.fn(),
          }}
          onChange={onChange}
        />
      </RepositoryProvider>,
      { reactStrictMode: true },
    );
    return onChange;
  }

  it("shows the core properties and keeps empty optional ones under Add property", () => {
    renderList();
    for (const name of ["Status", "Priority"])
      expect(screen.getByRole("combobox", { name })).toBeVisible();
    for (const name of ["Scheduled date", "Due date", "Edit Project"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.queryByText("Reminders")).toBeNull();
    expect(screen.queryByText("Repeat")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    const menu = screen.getByRole("menu", { name: "Add property" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(expect.arrayContaining(["Repeat", "Reminders", "Tags"]));
  });

  it("shows a set property without being added and summarises it", () => {
    renderList({
      due: "2029-11-20",
      reminders: [
        { id: "r1", type: "relative", relatedTo: "due", offset: "-PT1H" },
      ],
    });
    const reminders = screen.getByRole("button", { name: "Edit Reminders" });
    expect(reminders).toHaveTextContent("1h before due");
    expect(reminders).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reminders);
    expect(screen.getByRole("region", { name: "Reminder 1" })).toBeVisible();
  });

  it("adds a reminder from the menu with a preset", async () => {
    const onChange = renderList({ due: "2029-11-20" });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reminders" }));
    const preset = await screen.findByRole("button", {
      name: "Add 1 hour before due",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Reminders" }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
    fireEvent.click(preset);
    expect(onChange).toHaveBeenCalledWith({
      reminders: [
        expect.objectContaining({
          type: "relative",
          relatedTo: "due",
          offset: "-PT1H",
        }),
      ],
    });
  });

  it("opens the requested date target and offers both targets, typing and shortcuts", async () => {
    const onChange = renderList({
      scheduled: "2026-01-02T09:30",
      due: "2029-11-20",
    });
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    const dialog = screen.getByRole("dialog", { name: "Due date calendar" });
    expect(within(dialog).getByRole("radio", { name: /Due/ })).toBeChecked();
    fireEvent.click(within(dialog).getByText("Date options"));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /^Today$/ }),
      ).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: /Scheduled/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    expect(onChange).toHaveBeenCalledWith({
      scheduled: `${shiftTaskDate(todayString(), 1)}T09:30`,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Due date" })).toHaveFocus();
  });

  it("keeps the time editor inside date options", () => {
    renderList({ scheduled: "2026-01-02T09:30" });
    expect(screen.queryByRole("button", { name: "Scheduled time" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Scheduled date" }));
    fireEvent.click(screen.getByText("Date options"));
    fireEvent.click(screen.getByRole("button", { name: "Scheduled time" }));
    expect(
      screen.getByRole("dialog", { name: "Scheduled time" }),
    ).toBeVisible();
  });

  it("clears just the requested date and dismisses with Escape", async () => {
    const onChange = renderList({
      scheduled: "2026-01-02T09:30",
      due: "2029-11-20",
    });
    const trigger = screen.getByRole("button", { name: "Due date" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(onChange).toHaveBeenCalledWith({ due: undefined });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("anchors the phone date sheet across the viewport and returns focus without editing", async () => {
    vi.stubGlobal("innerWidth", 412);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const onChange = renderList({ scheduled: "2026-11-05" });
    const trigger = screen.getByRole("button", { name: "Scheduled date" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "Scheduled date calendar",
    });
    expect(dialog.style.width).toBe("412px");
    expect(dialog.style.left).toBe("0px");
    expect(dialog.style.top).toBe("auto");
    expect(dialog.style.bottom).toBe("0px");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dates" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes a value picker with Escape, keeping what was typed", async () => {
    const onChange = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Contexts" }));
    const contexts = await screen.findByRole("combobox", { name: "Contexts" });
    fireEvent.change(contexts, { target: { value: "errands" } });
    fireEvent.keyDown(contexts, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith({ contexts: ["errands"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit Contexts" })).toHaveFocus();
  });
});
