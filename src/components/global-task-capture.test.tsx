import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "../test/render";
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
