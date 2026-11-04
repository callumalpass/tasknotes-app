import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "../test/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryProvider } from "../app/repository-context";
import { todayString } from "../domain/task";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { TaskDatePanel } from "./task-date-panel";

import type { MdbaseTaskRepository } from "../storage/mdbase-repository";
import type { TaskSummary } from "../domain/task";

describe("TaskDatePanel", () => {
  let repository: MdbaseTaskRepository;

  beforeEach(async () => {
    repository = createTestMdbaseRepository();
    await repository.initialize();
  });

  function renderPanel(task: Partial<TaskSummary>) {
    const onApply = vi.fn();
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskDatePanel
          busy={false}
          task={{ id: "t", title: "Task", ...task } as TaskSummary}
          onApply={onApply}
        />
      </RepositoryProvider>,
    );
    return onApply;
  }

  it("targets the scheduled date unless only a due date exists", () => {
    renderPanel({ due: "2026-11-20" });
    expect(screen.getByRole("radio", { name: /Due/ })).toBeChecked();
  });

  it("keeps a task's time when a preset moves the day", () => {
    const onApply = renderPanel({ scheduled: "2026-01-02T09:30" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Today" }));
    expect(onApply).toHaveBeenCalledWith({
      scheduled: `${todayString()}T09:30`,
    });
  });

  it("applies a typed date to the chosen target on Enter", async () => {
    const onApply = renderPanel({});
    fireEvent.click(screen.getByRole("radio", { name: /Due/ }));
    const input = screen.getByLabelText("Type a date");
    fireEvent.change(input, { target: { value: "tomorrow" } });
    await screen.findByText(/^Enter to set/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onApply).toHaveBeenCalledWith({
      due: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
    });
  });

  it("says when a typed date can't be read", async () => {
    const onApply = renderPanel({});
    const input = screen.getByLabelText("Type a date");
    fireEvent.change(input, { target: { value: "bananas" } });
    await waitFor(() =>
      expect(screen.getByText("Couldn’t read that date")).toBeVisible(),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onApply).not.toHaveBeenCalled();
  });
});
