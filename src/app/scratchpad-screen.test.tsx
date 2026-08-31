import "fake-indexeddb/auto";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordMatchesLink } from "../domain/completion";
import type { ScratchFeedPage } from "../domain/scratch-feed";
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
    localStorage.clear();
    fixture = mdbaseFixture([]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
  });

  afterEach(() => vi.unstubAllGlobals());

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

  function mockVerifiedImageUpload() {
    return vi
      .spyOn(repository.files, "upload")
      .mockImplementation(async (path, source, options) => {
        const blob = source as Blob;
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        return {
          fileId: "pasted-file",
          path,
          revision: "file-1",
          contentDigest: `sha256:${[...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")}`,
          size: blob.size,
          mediaType: options?.mediaType,
          mediaClass: "image",
          modifiedAt: new Date().toISOString(),
        };
      });
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

    const actions = await screen.findByRole("button", {
      name: "Task actions for Prepare release notes",
    });
    fireEvent.click(actions);
    expect(
      await screen.findByRole("menu", {
        name: "Actions for Prepare release notes",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(link);
    await waitFor(() => expect(openTask).toHaveBeenCalledOnce());
  });

  it("toggles a portable draft checkbox and converts it as completed", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(input, { target: { value: "Publish the release" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark complete Publish the release",
      }),
    );

    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toBe(
        "- [x] Publish the release\n",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create task for Publish the release",
      }),
    );
    const completedStatus = (
      await repository.taskConfiguration()
    ).statuses.find((status) => status.isCompleted)?.value;
    expect(completedStatus).toBeTruthy();
    await waitFor(async () =>
      expect(await repository.list({ status: "all" })).toEqual([
        expect.objectContaining({
          title: "Publish the release",
          status: completedStatus,
          completed: true,
        }),
      ]),
    );
  });

  it("converts a draft task back to a note from the outline", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(input, { target: { value: "Keep this as context" } });
    const taskKind = screen.getByRole("button", {
      name: "Convert Keep this as context to note",
    });
    expect(taskKind).toHaveClass("scratchpad-kind-toggle");
    expect(taskKind).toHaveTextContent("Task");
    fireEvent.click(taskKind);

    const noteKind = screen.getByRole("button", { name: "Make a task" });
    expect(noteKind).toBeVisible();
    expect(noteKind).toHaveClass("scratchpad-kind-toggle");
    expect(noteKind).toHaveTextContent("Note");
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toBe(
        "- Keep this as context\n",
      ),
    );
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

  it("edits and clears an explicit note title", async () => {
    renderScratchpad();
    const title = await screen.findByRole(
      "textbox",
      { name: "Note title" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    expect(title).toHaveValue("");
    expect(screen.getByText("Current note")).toBeInTheDocument();

    fireEvent.change(title, { target: { value: "Research ideas" } });
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).title).toBe(
        "Research ideas",
      ),
    );

    fireEvent.change(title, { target: { value: "" } });
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).title).toBe(""),
    );
  });

  it("keeps the initial current-note wait visually quiet", async () => {
    const current = await repository.getActiveScratchpad();
    let resolveCurrent!: (document: typeof current) => void;
    vi.spyOn(repository, "getActiveScratchpad").mockReturnValue(
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    );

    renderScratchpad();

    expect(await screen.findByText("Opening current note…")).toHaveClass(
      "visually-hidden",
    );
    expect(document.querySelector(".scratchpad-loading")).toBeNull();
    await act(async () => resolveCurrent(current));
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Draft task: empty" },
        { timeout: SCRATCHPAD_LOAD_TIMEOUT },
      ),
    ).toBeVisible();
  });

  it("renders the current note before previous notes finish loading", async () => {
    const current = await repository.getActiveScratchpad();
    let resolveHistory!: (page: ScratchFeedPage) => void;
    const history = new Promise<ScratchFeedPage>((resolve) => {
      resolveHistory = resolve;
    });
    vi.spyOn(repository, "getActiveScratchpad").mockResolvedValue(current);
    const listScratchFeed = vi
      .spyOn(repository, "listScratchFeed")
      .mockReturnValue(history);

    renderScratchpad();

    expect(
      await screen.findByRole(
        "textbox",
        { name: "Draft task: empty" },
        { timeout: SCRATCHPAD_LOAD_TIMEOUT },
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(listScratchFeed).toHaveBeenCalledOnce());
    expect(screen.queryByText("Earlier note")).not.toBeInTheDocument();
    const scroller = document.querySelector(
      ".scratchpad-history-scroll",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () =>
        document
          .querySelector(".scratchpad-history")
          ?.classList.contains("is-loaded")
          ? 700
          : 400,
    });
    scroller.scrollTop = 120;
    expect(document.querySelector(".scratchpad-history")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await act(async () => {
      resolveHistory({
        current,
        items: [
          {
            kind: "scratchpad",
            ...current,
            id: "earlier",
            path: "TaskNotes/Scratchpad/earlier.md",
            revision: "earlier-r1",
            state: "converted",
            title: "Earlier note",
            dateCreated: "2026-07-01T00:00:00.000Z",
          },
        ],
      });
      await history;
    });

    expect(await screen.findByText("Earlier note")).toBeInTheDocument();
    expect(document.querySelector(".scratchpad-history")).toHaveClass(
      "is-loaded",
    );
    expect(scroller.scrollTop).toBe(420);
  });

  it("keeps the current note at the bottom of the feed scroller and leaves text paste untouched", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    const history = document.querySelector(".scratchpad-history-scroll")!;
    const current = document.querySelector(".scratchpad-current-document")!;
    expect(history.contains(current)).toBe(true);
    expect(history.lastElementChild).toBe(current);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { items: [{ kind: "string", type: "text/plain" }] },
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText(/Adding image/)).not.toBeInTheDocument();
  });

  it("stays pinned to the bottom while the current editor grows", async () => {
    let resize!: ResizeObserverCallback;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    const scroller = document.querySelector(
      ".scratchpad-history-scroll",
    ) as HTMLDivElement;
    let height = 400;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => height },
    });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    height = 700;
    act(() => resize([], {} as ResizeObserver));
    expect(scroller.scrollTop).toBe(700);

    fireEvent.wheel(scroller, { deltaY: -40 });
    scroller.scrollTop = 50;
    fireEvent.scroll(scroller);
    height = 900;
    act(() => resize([], {} as ResizeObserver));
    expect(scroller.scrollTop).toBe(50);
  });

  it("opens an accessible image capture panel and retains it after an invalid drop", async () => {
    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(screen.getByText(/Drop images here/)).toBeInTheDocument();
    const upload = screen.getByLabelText("Upload images");
    expect(upload).toHaveAttribute("accept", "image/*");
    expect(upload).toHaveAttribute("multiple");
    expect(screen.getByLabelText("Take photo")).toHaveAttribute(
      "capture",
      "environment",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/Drop images here/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add image" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));

    const surface = document.querySelector(".scratchpad-screen")!;
    const file = new File(["not an image"], "notes.txt", {
      type: "text/plain",
    });
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type }],
      types: ["Files"],
      dropEffect: "none",
    };
    fireEvent.dragEnter(surface, { dataTransfer });
    expect(screen.getByText("Drop images to add them")).toBeInTheDocument();
    fireEvent.drop(surface, { dataTransfer });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add an AVIF, GIF, HEIC, JPEG, PNG, or WebP image.",
    );
    expect(screen.getByText(/Drop images here/)).toBeInTheDocument();
  });

  it("uploads selected images and closes the capture panel after success", async () => {
    const uploadFile = mockVerifiedImageUpload();
    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "upload.png",
      { type: "image/png" },
    );

    fireEvent.change(screen.getByLabelText("Upload images"), {
      target: { files: [image, image] },
    });

    await screen.findByText("Image added");
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(
      (await repository.listScratchFeed()).items.filter(
        (item) => item.kind === "image",
      ),
    ).toHaveLength(1);
    expect(screen.queryByText(/Drop images here/)).not.toBeInTheDocument();
  });

  it("keeps successful files and the panel when a multi-file upload partly fails", async () => {
    mockVerifiedImageUpload();
    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "valid.png",
      { type: "image/png" },
    );
    const svg = new File(["<svg/>"], "invalid.svg", {
      type: "image/svg+xml",
    });

    fireEvent.change(screen.getByLabelText("Upload images"), {
      target: { files: [png, svg] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 image was added",
    );
    expect(screen.getByText(/Drop images here/)).toBeInTheDocument();
    expect((await repository.listScratchFeed()).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "image" })]),
    );
  });

  it("handles image-only paste anywhere on the surface as a free-floating card", async () => {
    mockVerifiedImageUpload();
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "paste.png",
      { type: "image/png" },
    );
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await screen.findByText("Image added");
    expect((await repository.listScratchFeed()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "image", size: image.size }),
      ]),
    );
    expect((await repository.getActiveScratchpad()).body).toBe("");
  });

  it("switches between the outline and Markdown without separate add buttons", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    expect(screen.queryByRole("button", { name: "Add task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
    fireEvent.change(input, { target: { value: "Source round trip" } });

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const source = await screen.findByRole("textbox", {
      name: "Scratchpad Markdown",
    });
    expect(source).toHaveTextContent("- [ ] Source round trip");
    expect(source).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(
      await screen.findByRole("textbox", {
        name: "Draft task: Source round trip",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Draft task: empty" }),
    ).toHaveFocus();
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

    fireEvent.click(screen.getByRole("button", { name: "Create task notes" }));
    const dialog = screen.getByRole("dialog", { name: "Create task notes" });
    expect(dialog).toHaveTextContent("2 of 2 selected");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Write announcement" }),
    );
    expect(dialog).toHaveTextContent("1 of 2 selected");
    fireEvent.click(
      screen.getByRole("button", { name: "Create 1 task notes" }),
    );

    await screen.findByText("Created 1 task note");
    expect(await repository.list({ status: "all" })).toEqual([
      expect.objectContaining({ title: "Plan launch" }),
    ]);
    const active = await repository.getActiveScratchpad();
    expect(active.body).toContain("[[tasks/");
    expect(active.body).toContain("  - [ ] Write announcement");
    expect(
      [...fixture.records.values()].filter(
        (record) => record.frontmatter.state === "converted",
      ),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(openTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan launch" }),
    );
  });

  it("creates selected hierarchy in place, then starts a new note", async () => {
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

    fireEvent.keyDown(child, { key: "Enter" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Actions for empty item" }).at(-1)!,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep as note" }));
    const note = await screen.findByRole("textbox", { name: "Note: empty" });
    fireEvent.change(note, {
      target: { value: "Keep the tone straightforward" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task notes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create 2 task notes" }),
    );

    await screen.findByText("Created 2 task notes");
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

    const previous = await repository.getActiveScratchpad();
    expect(previous.body).toContain("Keep the tone straightforward");
    expect(previous.body.match(/\[\[tasks\//g)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(previous.id),
    );
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument();
    const preserved = [...fixture.records.values()].find(
      (record) => record.frontmatter.id === previous.id,
    );
    expect(preserved?.body).toContain("Keep the tone straightforward");
    expect(preserved?.body).toContain("[[tasks/");
  });

  it("starts a new note without creating tasks", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "An idea for later" } });
    const previous = await repository.getActiveScratchpad();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(previous.id),
    );
    expect(await repository.list({ status: "all" })).toHaveLength(0);
    expect((await repository.getActiveScratchpad()).body).toBe("");
    const currentEditor = await screen.findByRole(
      "region",
      { name: "Editor for current scratchpad" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    const currentInput = await within(currentEditor).findByRole("textbox", {
      name: "Draft task: empty",
    });
    await waitFor(() => expect(currentInput).toHaveFocus());
    const preserved = [...fixture.records.values()].find(
      (record) => record.frontmatter.state === "converted",
    );
    expect(preserved?.body).toContain("- [ ] An idea for later");
    expect(preserved?.frontmatter.title).toBe("");
    const historicalCard = document.querySelector(".scratchpad-document")!;
    expect(historicalCard).not.toHaveTextContent("An idea for later");
    expect(historicalCard.querySelector("time")).not.toBeNull();
    expect(
      historicalCard.querySelector(".scratchpad-document-chevron"),
    ).not.toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Create task notes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create 2 task notes" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary write failure",
    );
    expect(
      screen.getByRole("button", { name: "Retry 1 task notes" }),
    ).toBeEnabled();
    expect(await repository.list({ status: "all" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry 1 task notes" }));
    await screen.findByText("Created 2 task notes");
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

  it("expands and revision-saves historical documents without collapsing the current editor", async () => {
    const current = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: "- [ ] Historical draft\n",
    });
    await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
      title: "Earlier notes",
    });

    renderScratchpad();
    expect(
      await screen.findByRole("textbox", { name: "Draft task: empty" }),
    ).toBeVisible();
    const historyDisclosure = screen.getByRole("button", {
      name: /Earlier notes/,
    });
    expect(historyDisclosure).toHaveAttribute("aria-expanded", "false");
    const currentEditor = screen.getByRole("region", {
      name: "Editor for current scratchpad",
    });
    expect(
      historyDisclosure.compareDocumentPosition(currentEditor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(historyDisclosure);

    const historicalInput = await screen.findByRole("textbox", {
      name: "Draft task: Historical draft",
    });
    expect(
      within(currentEditor).getByRole("textbox", {
        name: "Draft task: empty",
      }),
    ).toBeVisible();
    fireEvent.change(historicalInput, {
      target: { value: "Edited historical draft" },
    });
    fireEvent.click(historyDisclosure);

    await waitFor(async () =>
      expect((await repository.getScratchpad(saved.id))?.body).toContain(
        "Edited historical draft",
      ),
    );
    expect(
      screen.queryByRole("textbox", {
        name: "Draft task: Edited historical draft",
      }),
    ).toBeNull();
  });

  it("preserves expanded history and collapsed images across new notes and reloads", async () => {
    const current = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: "- [ ] Historical draft\n",
      title: "Earlier notes",
    });
    await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
    });
    await repository.createScratchImage({
      id: "persistent-image",
      path: "TaskNotes/Scratchpad/Image Metadata/persistent-image.md",
      dateCreated: "2026-08-30T08:00:00.000Z",
      file: "TaskNotes/Scratchpad/Images/persistent-image.png",
      digest: `sha256:${"a".repeat(64)}`,
      size: 8,
      mediaType: "image/png",
    });
    const collection = await repository.collectionInfo();
    const storageKey = `tasknotes:scratchpad-collapse:${collection.id}`;
    const historyDisclosure = () =>
      document.querySelector<HTMLButtonElement>(
        `[data-feed-key="scratchpad:${saved.id}"] > .scratchpad-document-disclosure`,
      )!;

    renderScratchpad();
    await screen.findByRole("textbox", { name: "Draft task: empty" });
    await waitFor(() =>
      expect(localStorage.getItem(storageKey)).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Earlier notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse image" }));
    expect(
      screen.getByRole("button", { name: "Expand image" }),
    ).toHaveAttribute("aria-expanded", "false");

    const activeBefore = await repository.getActiveScratchpad();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(
        activeBefore.id,
      ),
    );
    expect(historyDisclosure()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Expand image" })).toBeVisible();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      expect(stored.expandedDocuments).toContain(saved.id);
      expect(stored.collapsedImages).toContain("persistent-image");
    });

    cleanup();
    renderScratchpad();
    expect(
      await screen.findAllByRole("textbox", { name: "Draft task: empty" }),
    ).not.toHaveLength(0);
    await waitFor(() =>
      expect(historyDisclosure()).toHaveAttribute("aria-expanded", "true"),
    );
    expect(screen.getByRole("button", { name: "Expand image" })).toBeVisible();
  });

  it("collapses history without a storage error while its editor is loading", async () => {
    const current = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: "- [ ] Historical draft\n",
    });
    await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
      title: "Earlier notes",
    });
    const getScratchpad = repository.getScratchpad.bind(repository);
    let releaseHistory!: () => void;
    const historyBlocked = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    vi.spyOn(repository, "getScratchpad").mockImplementation(async (id) => {
      if (id === saved.id) await historyBlocked;
      return getScratchpad(id);
    });

    renderScratchpad();
    await screen.findByRole("textbox", { name: "Draft task: empty" });
    const historyDisclosure = screen.getByRole("button", {
      name: /Earlier notes/,
    });
    fireEvent.click(historyDisclosure);
    expect(historyDisclosure).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(historyDisclosure);

    await waitFor(() =>
      expect(historyDisclosure).toHaveAttribute("aria-expanded", "false"),
    );
    expect(
      screen.queryByText("Scratchpad storage is unavailable."),
    ).not.toBeInTheDocument();
    await act(async () => {
      releaseHistory();
      await historyBlocked;
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Create task notes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create 1 task notes" }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(320));
    const savesBeforeRelease = saveScratchpad.mock.calls.length;
    vi.useRealTimers();
    expect(savesBeforeRelease).toBe(0);

    releaseCreate();
    await screen.findByText("Created 1 task note");
    expect((await repository.getActiveScratchpad()).body).toContain("[[tasks/");
  });
});
