import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "../test/render";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import type { NextTaskRepository } from "../storage/next-repository";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { GlobalTaskCapture } from "./global-task-capture";

describe("GlobalTaskCapture", () => {
  let repository: NextTaskRepository;

  beforeEach(async () => {
    localStorage.clear();
    ({ repository } = await nextTaskFixture());
    await repository.initialize();
  });

  it("an earlier refresh cannot close a newly opened draft", async () => {
    let finish!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <Harness onOpenTask={vi.fn()} onCreated={() => refresh} />
      </RepositoryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    fireEvent.change(screen.getByRole("combobox", { name: "New task title" }), {
      target: { value: "First task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    fireEvent.change(screen.getByRole("combobox", { name: "New task title" }), {
      target: { value: "Second task" },
    });
    finish();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "New task title" }),
      ).toHaveValue("Second task"),
    );
  });
});

function Harness({
  onOpenTask,
  onCreated,
}: {
  onOpenTask: () => void;
  onCreated?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open capture
      </button>
      <GlobalTaskCapture
        open={open}
        onClose={() => setOpen(false)}
        onOpenTask={onOpenTask}
        onCreated={onCreated}
      />
    </>
  );
}

it("Escape closes only autocomplete first, then keeps the draft when closing capture", async () => {
  const { repository } = await nextTaskFixture();
  await repository.initialize();
  render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
      <Harness onOpenTask={vi.fn()} />
    </RepositoryProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
  const input = screen.getByRole("combobox", { name: "New task title" });
  fireEvent.change(input, {
    target: { value: "Call Rowan !", selectionStart: 12 },
  });
  await screen.findByRole("listbox", { name: "Task field suggestions" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("dialog", { name: "New task" })).toBeVisible();
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
  expect(screen.getByRole("combobox", { name: "New task title" })).toHaveValue(
    "Call Rowan !",
  );
});

it("Shift+Enter opens details without adding a task", async () => {
  const { repository } = await nextTaskFixture();
  await repository.initialize();
  const create = vi.spyOn(repository, "create");
  render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
      <Harness onOpenTask={vi.fn()} />
    </RepositoryProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
  const input = screen.getByRole("combobox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "Call Rowan" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  const date = await screen.findByRole("button", {
    name: "Scheduled date",
  });
  await waitFor(() => expect(date).toHaveFocus());
  expect(create).not.toHaveBeenCalled();
});
