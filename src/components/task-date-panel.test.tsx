import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryProvider } from "../app/repository-context";
import { todayString } from "../domain/task";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import { TaskDatePanel } from "./task-date-panel";

import type { NextTaskRepository } from "../storage/next-repository";
import type { TaskSummary } from "../domain/task";

describe("TaskDatePanel", () => {
  let repository: NextTaskRepository;
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    ({ repository } = await nextTaskFixture());
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
    fireEvent.click(screen.getByText("Date options"));
    expect(screen.getByRole("radio", { name: /Due/ })).toBeChecked();
  });

  it("keeps a task's time when a preset moves the day", () => {
    const onApply = renderPanel({ scheduled: "2026-01-02T09:30" });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onApply).toHaveBeenCalledWith({
      scheduled: `${todayString()}T09:30`,
    });
  });

  it("selects the local day of a stored instant east of UTC", () => {
    vi.stubEnv("TZ", "Australia/Melbourne");
    renderPanel({ due: "2026-11-04T22:00:00Z" });
    expect(
      screen.getByRole("gridcell", { selected: true }),
    ).toHaveAccessibleName(/November 5/);
  });

  it("applies a typed date to the chosen target on Enter", async () => {
    const onApply = renderPanel({});
    fireEvent.click(screen.getByText("Date options"));
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
    fireEvent.click(screen.getByText("Date options"));
    const input = screen.getByLabelText("Type a date");
    fireEvent.change(input, { target: { value: "bananas" } });
    await waitFor(() =>
      expect(screen.getByText("Couldn’t read that date")).toBeVisible(),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onApply).not.toHaveBeenCalled();
  });
});
