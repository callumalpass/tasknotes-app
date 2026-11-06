import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/render";
import { RepositoryProvider } from "../app/repository-context";
import { todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import { TaskDetailDates } from "./task-detail-dates";
import type { NextTaskRepository } from "../storage/next-repository";

describe("shared detail dates", () => {
  let repository: NextTaskRepository;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    ({ repository } = await nextTaskFixture());
    await repository.initialize();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  function renderDates(compact = false) {
    const onChange = vi.fn();
    render(
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <TaskDetailDates
          compact={compact}
          draft={{ scheduled: "2026-01-02T09:30", due: "2029-11-20" }}
          onChange={onChange}
        />
      </RepositoryProvider>,
      { reactStrictMode: true },
    );
    return onChange;
  }

  it("opens the requested target and offers both targets, typing and shortcuts", async () => {
    const onChange = renderDates();
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    const dialog = screen.getByRole("dialog", { name: "Due date calendar" });
    expect(within(dialog).getByRole("radio", { name: /Due/ })).toBeChecked();
    expect(within(dialog).getByRole("radiogroup")).toBeVisible();
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

  it("keeps the time editor inside compact date options", () => {
    renderDates(true);
    expect(screen.queryByRole("button", { name: "Scheduled time" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Scheduled date" }));
    fireEvent.click(screen.getByText("Date options"));
    fireEvent.click(screen.getByRole("button", { name: "Scheduled time" }));
    expect(
      screen.getByRole("dialog", { name: "Scheduled time" }),
    ).toBeVisible();
  });

  it("clears just the requested draft field and dismisses with Escape", async () => {
    const onChange = renderDates();
    const trigger = screen.getByRole("button", {
      name: "Due date",
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(onChange).toHaveBeenCalledWith({ due: undefined });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
