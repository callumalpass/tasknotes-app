import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordMatchesLink } from "../domain/completion";
import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { MemoryVault } from "../test/memory-vault";
import { RepositoryProvider } from "./repository-context";
import { ScratchpadScreen } from "./scratchpad-screen";

const SCRATCHPAD_LOAD_TIMEOUT = 5_000;

describe("ScratchpadScreen", () => {
  let vault: MemoryVault;
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;

  beforeEach(async () => {
    vault = new MemoryVault();
    index = new TaskIndex(`scratchpad-screen-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  function renderScratchpad(onOpenTask = vi.fn()) {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <ScratchpadScreen onOpenTask={onOpenTask} />
      </RepositoryProvider>,
    );
    return onOpenTask;
  }

  it("converts one draft in place and preserves its linked Markdown", async () => {
    const openTask = renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      {
        name: "Draft task: empty",
      },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(input, {
      target: { value: "Prepare release notes tomorrow" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create TaskNote for Prepare release notes tomorrow",
      }),
    );

    const link = await screen.findByRole("button", {
      name: "Prepare release notes",
    });
    await waitFor(async () => {
      expect(await repository.list({ status: "all" })).toEqual([
        expect.objectContaining({
          title: "Prepare release notes",
          scheduled: expect.any(String),
        }),
      ]);
      expect((await repository.getActiveScratchpad()).body).toMatch(
        /\[\[tasks\/.+\]\]/,
      );
    });

    fireEvent.click(link);
    await waitFor(() => expect(openTask).toHaveBeenCalledOnce());
  });

  it("resolves a linked task title after reloading a bare filepath", async () => {
    const created = await repository.create({ title: "Filename title" });
    const renamed = await repository.update(created.id, {
      title: "Readable title property",
    });
    const scratchpad = await repository.getActiveScratchpad();
    await repository.saveScratchpad({
      id: scratchpad.id,
      path: scratchpad.path,
      revision: scratchpad.revision,
      body: `- [[${renamed.path.replace(/\.md$/i, "")}]]\n`,
    });

    renderScratchpad();

    expect(
      await screen.findByRole("button", { name: "Readable title property" }),
    ).toBeVisible();
    expect(screen.queryByText("Filename title")).not.toBeInTheDocument();
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toContain(
        "|Readable title property]]",
      ),
    );
  });

  it("finishes a mixed outline, retains notes, and creates subtask links", async () => {
    renderScratchpad();
    const parent = await screen.findByRole(
      "textbox",
      {
        name: "Draft task: empty",
      },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(parent, { target: { value: "Plan launch" } });
    fireEvent.keyDown(parent, { key: "Enter" });
    const child = await screen.findByRole("textbox", {
      name: "Draft task: empty",
    });
    fireEvent.change(child, { target: { value: "Write announcement" } });
    fireEvent.keyDown(child, { key: "Tab" });

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    const note = await screen.findByRole("textbox", { name: "Note: empty" });
    fireEvent.change(note, {
      target: { value: "Keep the tone straightforward" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByRole("dialog", { name: "Finish this scratchpad?" }),
    ).toHaveTextContent("2 draft tasks");
    fireEvent.click(
      screen.getByRole("button", { name: "Create tasks and finish" }),
    );

    await screen.findByText("Finished “Plan launch”");
    await waitFor(async () => {
      const tasks = await repository.list({ status: "all" });
      expect(tasks).toHaveLength(2);
      const parentTask = tasks.find((task) => task.title === "Plan launch")!;
      const childTask = tasks.find(
        (task) => task.title === "Write announcement",
      )!;
      expect(childTask.projects).toHaveLength(1);
      expect(recordMatchesLink(parentTask.path, childTask.projects[0]!)).toBe(
        true,
      );
    });

    const active = await repository.getActiveScratchpad();
    expect(active.body).toBe("");
    const archive = [...vault.files.entries()].find(
      ([path]) =>
        path.startsWith("scratchpads/") && path !== "scratchpads/Scratchpad.md",
    );
    const archivedText = new TextDecoder().decode(archive?.[1].contents);
    expect(archivedText).toContain("Keep the tone straightforward");
    expect(archivedText).toContain("[[tasks/");
  });
});
