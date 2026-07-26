import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { GlobalTaskCapture } from "./global-task-capture";

describe("GlobalTaskCapture", () => {
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;

  beforeEach(async () => {
    localStorage.clear();
    index = new TaskIndex(`global-capture-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    });
    await repository.initialize();
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  it("focuses, creates through the repository, and closes", async () => {
    const onOpenTask = vi.fn();
    render(
      <RepositoryProvider repository={repository}>
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

  it("closes on Escape and restores the invoking control", async () => {
    render(
      <RepositoryProvider repository={repository}>
        <Harness onOpenTask={vi.fn()} />
      </RepositoryProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Open capture" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull();
  });
});

function Harness({ onOpenTask }: { onOpenTask: () => void }) {
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
      />
    </>
  );
}
