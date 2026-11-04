import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/render";
import { RepositoryProvider } from "../app/repository-context";
import { todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { TaskDetailDates } from "./task-detail-dates";
import type { MdbaseTaskRepository } from "../storage/mdbase-repository";

describe("shared detail dates", () => {
  let repository: MdbaseTaskRepository;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    repository = createTestMdbaseRepository();
    await repository.initialize();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  function renderDates() {
    const onChange = vi.fn();
    render(
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <TaskDetailDates
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
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Type a date")).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: /Scheduled/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    expect(onChange).toHaveBeenCalledWith({
      scheduled: `${shiftTaskDate(todayString(), 1)}T09:30`,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Due date" })).toHaveFocus();
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
