import "fake-indexeddb/auto";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordMatchesLink } from "../domain/completion";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { mdbaseFixture } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { ScratchpadScreen } from "./scratchpad-screen";

const SCRATCHPAD_LOAD_TIMEOUT = 5_000;

describe("ScratchpadScreen", () => {
  let fixture: ReturnType<typeof mdbaseFixture>;
  let repository: MdbaseTaskRepository;

  beforeEach(async () => {
    fixture = mdbaseFixture([]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
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
        name: "Create task for Prepare release notes tomorrow",
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

  it("sends the editor's base body with an autosave", async () => {
    const saveScratchpad = vi.spyOn(repository, "saveScratchpad");
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );

    fireEvent.change(input, { target: { value: "A durable draft" } });

    await waitFor(() =>
      expect(saveScratchpad).toHaveBeenCalledWith(
        expect.objectContaining({
          baseBody: "",
          body: "- [ ] A durable draft\n",
        }),
      ),
    );
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
      baseBody: scratchpad.body,
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

  it("converts only selected drafts and leaves the rest active", async () => {
    const openTask = renderScratchpad();
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

    fireEvent.click(screen.getByRole("button", { name: "Review tasks" }));
    const dialog = screen.getByRole("dialog", { name: "Review task drafts" });
    expect(dialog).toHaveTextContent("2 of 2 selected");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Write announcement" }),
    );
    expect(dialog).toHaveTextContent("1 of 2 selected");
    fireEvent.click(screen.getByRole("button", { name: "Create 1 task" }));

    await screen.findByText("Created 1 task");
    expect(await repository.list({ status: "all" })).toEqual([
      expect.objectContaining({ title: "Plan launch" }),
    ]);
    const active = await repository.getActiveScratchpad();
    expect(active.body).toContain("[[tasks/");
    expect(active.body).toContain("  - [ ] Write announcement");
    expect(
      [...fixture.records.values()].filter(
        (record) =>
          record.path.startsWith("scratchpads/") &&
          record.path !== "scratchpads/Scratchpad.md",
      ),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(openTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan launch" }),
    );
  });

  it("creates selected hierarchy in place, then archives it separately", async () => {
    renderScratchpad();
    const parent = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
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
    fireEvent.click(screen.getByRole("button", { name: "Review tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Create 2 tasks" }));

    await screen.findByText("Created 2 tasks");
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

    const activeBeforeArchive = await repository.getActiveScratchpad();
    expect(activeBeforeArchive.body).toContain("Keep the tone straightforward");
    expect(activeBeforeArchive.body.match(/\[\[tasks\//g)).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "More scratchpad actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Archive and start new" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Archive and start new?" }),
    ).toHaveTextContent("No tasks will be created");
    fireEvent.click(
      screen.getByRole("button", { name: "Archive and start new" }),
    );
    await screen.findByText("Archived “Plan launch”");

    const active = await repository.getActiveScratchpad();
    expect(active.body).toBe("");
    const archive = [...fixture.records.values()].find(
      (record) =>
        record.path.startsWith("scratchpads/") &&
        record.path !== "scratchpads/Scratchpad.md",
    );
    expect(archive?.body).toContain("Keep the tone straightforward");
    expect(archive?.body).toContain("[[tasks/");
  });

  it("archives drafts without creating tasks", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(input, { target: { value: "An idea for later" } });
    fireEvent.click(
      screen.getByRole("button", { name: "More scratchpad actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Archive and start new" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Archive and start new?" }),
    ).toHaveTextContent(
      "1 draft item will remain only in the archived outline",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Archive and start new" }),
    );

    await screen.findByText("Archived “An idea for later”");
    expect(await repository.list({ status: "all" })).toHaveLength(0);
    expect((await repository.getActiveScratchpad()).body).toBe("");
    expect(
      [...fixture.records.values()].find(
        (record) => record.path !== "scratchpads/Scratchpad.md",
      )?.body,
    ).toContain("- [ ] An idea for later");
  });

  it("shows row failures and retries only the failed draft", async () => {
    const create = repository.create.bind(repository);
    let attempts = 0;
    vi.spyOn(repository, "create").mockImplementation(async (input) => {
      attempts += 1;
      if (attempts === 2) throw new Error("Temporary write failure");
      return create(input);
    });
    renderScratchpad();
    const first = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(first, { target: { value: "First task" } });
    fireEvent.keyDown(first, { key: "Enter" });
    const second = await screen.findByRole("textbox", {
      name: "Draft task: empty",
    });
    fireEvent.change(second, { target: { value: "Second task" } });
    fireEvent.click(screen.getByRole("button", { name: "Review tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Create 2 tasks" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary write failure",
    );
    expect(screen.getByRole("button", { name: "Retry 1 task" })).toBeEnabled();
    expect(await repository.list({ status: "all" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry 1 task" }));
    await screen.findByText("Created 2 tasks");
    expect(await repository.list({ status: "all" })).toHaveLength(2);
    expect(attempts).toBe(3);
  });

  it("collapses branches and exposes hierarchy controls for the active row", async () => {
    renderScratchpad();
    const parent = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(parent, { target: { value: "Parent" } });
    fireEvent.keyDown(parent, { key: "Enter" });
    const child = await screen.findByRole("textbox", {
      name: "Draft task: empty",
    });
    fireEvent.change(child, { target: { value: "Child" } });
    fireEvent.focus(child);
    fireEvent.click(screen.getByRole("button", { name: "Indent" }));
    expect(screen.getByRole("treeitem", { name: /Child/ })).toHaveAttribute(
      "aria-level",
      "2",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse Parent, 1 nested item",
      }),
    );
    expect(screen.queryByRole("textbox", { name: "Draft task: Child" })).toBe(
      null,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Parent, 1 nested item" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Draft task: Child" }),
    ).toBeVisible();
  });

  it("suspends a pending autosave as soon as reviewed conversion begins", async () => {
    const saveScratchpad = vi.spyOn(repository, "saveScratchpad");
    const create = repository.create.bind(repository);
    let releaseCreate!: () => void;
    const createBlocked = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    vi.spyOn(repository, "create").mockImplementation(async (input) => {
      await createBlocked;
      return create(input);
    });
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: "Plan launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Review tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Create 1 task" }));

    await act(async () => vi.advanceTimersByTimeAsync(320));
    const savesBeforeRelease = saveScratchpad.mock.calls.length;
    vi.useRealTimers();
    expect(savesBeforeRelease).toBe(0);

    releaseCreate();
    await screen.findByText("Created 1 task");
    expect((await repository.getActiveScratchpad()).body).toContain("[[tasks/");
  });
});
