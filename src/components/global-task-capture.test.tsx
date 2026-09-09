import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { GlobalTaskCapture } from "./global-task-capture";

describe("GlobalTaskCapture", () => {
  let repository: MdbaseTaskRepository;

  beforeEach(async () => {
    localStorage.clear();
    repository = createTestMdbaseRepository();
    await repository.initialize();
  });

  it("focuses, creates through the repository, and closes", async () => {
    const onOpenTask = vi.fn();
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <Harness onOpenTask={onOpenTask} />
      </RepositoryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    const input = await screen.findByRole("combobox", {
      name: "New task title",
    });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "Capture from anywhere" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull(),
    );
    expect(await repository.list({ search: "anywhere" })).toHaveLength(1);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("can keep the composer open for consecutive capture", async () => {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <Harness onOpenTask={vi.fn()} />
      </RepositoryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep adding tasks" }),
    );
    const input = screen.getByRole("combobox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "First of several" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByRole("dialog", { name: "New task" })).toBeVisible();
    expect(input).toHaveFocus();
    expect(await repository.list({ search: "First of several" })).toHaveLength(
      1,
    );
  });

  it("keeps the draft when the sheet is dismissed and reopened", async () => {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <Harness onOpenTask={vi.fn()} />
      </RepositoryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    fireEvent.change(screen.getByRole("combobox", { name: "New task title" }), {
      target: { value: "Do not lose me tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close new task" }));
    fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
    expect(
      screen.getByRole("combobox", { name: "New task title" }),
    ).toHaveValue("Do not lose me tomorrow");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      screen.getByRole("combobox", { name: "New task title" }),
    ).toHaveValue("");
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

  it("closes on Escape and restores the invoking control", async () => {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <Harness onOpenTask={vi.fn()} />
      </RepositoryProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Open capture" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull();
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
