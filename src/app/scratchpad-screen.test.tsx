import "fake-indexeddb/auto";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordMatchesLink } from "../domain/completion";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import {
  deferred,
  mdbaseFixture,
  taskRecord,
  type TestRecord,
} from "../test/mdbase-fixture";
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

  let leaveScratchpad: () => void;

  function renderScratchpad(onOpenTask = vi.fn()) {
    const mutationJournal = new MemoryMutationJournal();
    const tree = (visible: boolean) => (
      <RepositoryProvider
        mutationJournal={mutationJournal}
        repository={repository}
      >
        {visible ? <ScratchpadScreen onOpenTask={onOpenTask} /> : null}
      </RepositoryProvider>
    );
    const { rerender } = render(tree(true));
    // Navigation unmounts the screen while the collection stays connected.
    leaveScratchpad = () => rerender(tree(false));
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

  it("distinguishes native note pending metadata from authority Saved (component port stand-in)", async () => {
    const current = await repository.getActiveScratchpad();
    const writeState = vi.fn(() => "pending" as const);
    Object.assign(repository, { writeState });
    renderScratchpad();
    await screen.findByRole("textbox", { name: "Draft task: empty" });
    expect(screen.queryByText("Syncing…")).toBeNull();
    expect(screen.queryByText("Saved", { exact: true })).toBeNull();
    expect(
      await screen.findByText("Syncing…", {}, { timeout: 3_000 }),
    ).toBeVisible();
    expect(writeState).toHaveBeenCalledWith({
      kind: "scratchpad",
      id: current.id,
    });
  });

  it("keeps the original text when a note save result fails (component stand-in)", async () => {
    const save = vi
      .spyOn(repository, "saveScratchpad")
      .mockRejectedValue(new Error("Native result unavailable"));
    Object.assign(repository, { writeState: () => "unknown" as const });
    renderScratchpad();
    const input = await screen.findByRole("textbox", {
      name: "Draft task: empty",
    });
    fireEvent.change(input, { target: { value: "Retained original text" } });
    await screen.findByText("Save needs review");
    expect(screen.getByText("Save outcome unknown")).toBeVisible();
    expect(save).toHaveBeenCalledOnce();
    expect(input).toHaveValue("Retained original text");
  });

  it("toggles a portable draft checkbox and converts it as completed in one write", async () => {
    const create = vi.spyOn(repository, "create");
    const update = vi.spyOn(repository, "update");
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
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ status: completedStatus }),
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("autosaves an incomplete wikilink and a later repair", async () => {
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fixture.update.mockClear();

    fireEvent.change(input, { target: { value: "Draft [[Plan" } });

    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Draft [[Plan\n",
      });
      expect(screen.getByText("Saved")).toBeVisible();
    });
    expect(fixture.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: "- [ ] Draft [[Plan\n" }),
      expect.anything(),
    );

    fireEvent.change(input, { target: { value: "Draft [[Plan]]" } });

    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Draft [[Plan]]\n",
      });
      expect(fixture.update).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Not saved")).toBeNull();
  });

  it("shows a generic autosave rejection and clears it after recovery", async () => {
    fixture.update.mockRejectedValueOnce(new Error("Temporary save failure"));
    renderScratchpad();
    const input = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );

    fireEvent.change(input, { target: { value: "First attempt" } });

    expect(await screen.findByText("Not saved")).toBeVisible();
    expect(screen.getByText("Temporary save failure")).toBeVisible();

    fireEvent.change(input, { target: { value: "Recovered draft" } });

    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Recovered draft\n",
      });
      expect(screen.getByText("Saved")).toBeVisible();
    });
    expect(screen.queryByText("Temporary save failure")).toBeNull();
  });

  it("adds the next line after an exact task row's existing children", async () => {
    cleanup();
    fixture = mdbaseFixture([
      taskRecord("suggested", "Suggested task", "task-r1"),
    ]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    renderScratchpad();
    const parent = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(parent, { target: { value: "Parent" } });
    fireEvent.keyDown(parent, { key: "Enter" });
    const child = screen.getByRole("textbox", { name: "Draft task: empty" });
    fireEvent.keyDown(child, { key: "Tab" });
    fireEvent.change(child, { target: { value: "Child" } });

    const editedParent = screen.getByRole("textbox", {
      name: "Draft task: Parent",
    });
    fireEvent.focus(editedParent);
    fireEvent.change(editedParent, { target: { value: "[[Suggested" } });
    fireEvent.click(
      await screen.findByRole("option", { name: /Suggested task/ }),
    );

    expect(
      screen.getByRole("textbox", { name: "Draft task: empty" }),
    ).toHaveFocus();
    await waitFor(async () => {
      const body = (await repository.getActiveScratchpad()).body;
      expect(body).toMatch(
        /^- \[\[tasks\/.+\|Suggested task\]\]\n {2}- \[ \] Child\n$/,
      );
    });
  });

  it("keeps an exact non-task record link as editable outline note content", async () => {
    cleanup();
    const project: TestRecord = {
      path: "Projects/Plan.md",
      revision: "project-r1",
      types: ["project"],
      frontmatter: { title: "Project plan" },
      body: "",
    };
    const linkedScratchpad: TestRecord = {
      path: "scratchpads/Scratchpad.md",
      revision: "scratch-r1",
      types: ["tasknotes-scratch"],
      frontmatter: {
        type: "tasknotes-scratch",
        id: "current",
        state: "active",
        dateCreated: "2026-08-31T00:00:00.000Z",
        dateModified: "2026-08-31T00:00:00.000Z",
      },
      body: "- [[Projects/Plan|Project plan]]\n",
    };
    fixture = mdbaseFixture([
      project,
      taskRecord("task", "Actual task", "task-r1"),
      linkedScratchpad,
    ]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    renderScratchpad();

    expect(
      await screen.findByRole("textbox", {
        name: "Note: [[Projects/Plan|Project plan]]",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Linked")).toBeNull();
    expect((await repository.getActiveScratchpad()).body).toBe(
      "- [[Projects/Plan|Project plan]]\n",
    );
  });

  it("does not resolve a basename-only non-task link to a task in another folder", async () => {
    cleanup();
    const task = {
      ...taskRecord("task", "Task plan", "task-r1"),
      path: "tasks/Plan.md",
    };
    const linkedScratchpad: TestRecord = {
      path: "scratchpads/Scratchpad.md",
      revision: "scratch-r1",
      types: ["tasknotes-scratch"],
      frontmatter: {
        type: "tasknotes-scratch",
        id: "current",
        state: "active",
        dateCreated: "2026-08-31T00:00:00.000Z",
        dateModified: "2026-08-31T00:00:00.000Z",
      },
      body: "- [[Plan]]\n",
    };
    fixture = mdbaseFixture([task, linkedScratchpad]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    renderScratchpad();

    expect(
      await screen.findByRole("textbox", { name: "Note: [[Plan]]" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Task plan" })).toBeNull();
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

  async function saveTitleFromAnotherTab(nextTitle: string) {
    const otherTab = new MdbaseTaskRepository(fixture.connect);
    await otherTab.initialize();
    const current = await otherTab.getActiveScratchpad();
    await otherTab.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: current.body,
      title: nextTitle,
    });
    // The collection reports the other tab's change to this tab.
    await act(async () => void (await repository.refresh()));
  }

  it("shows a note title changed in another tab", async () => {
    renderScratchpad();
    const title = await screen.findByRole(
      "textbox",
      { name: "Note title" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    expect(title).toHaveValue("");

    await saveTitleFromAnotherTab("From another tab");

    await waitFor(() => expect(title).toHaveValue("From another tab"));
  });

  it("keeps an unsaved title when another tab changes the note", async () => {
    const save = vi
      .spyOn(repository, "saveScratchpad")
      .mockImplementation(() => new Promise(() => undefined));
    renderScratchpad();
    const title = await screen.findByRole(
      "textbox",
      { name: "Note title" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(title, { target: { value: "My title" } });
    await waitFor(() => expect(save).toHaveBeenCalled());

    await saveTitleFromAnotherTab("From another tab");

    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(title).toHaveValue("My title");
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

  it("keeps newer Markdown edits when Outline hydration is still loading", async () => {
    cleanup();
    const task = taskRecord("task", "Linked task", "task-r1");
    const linkedScratchpad: TestRecord = {
      path: "scratchpads/Scratchpad.md",
      revision: "scratch-r1",
      types: ["tasknotes-scratch"],
      frontmatter: {
        type: "tasknotes-scratch",
        id: "current",
        state: "active",
        dateCreated: "2026-08-31T00:00:00.000Z",
        dateModified: "2026-08-31T00:00:00.000Z",
      },
      body: `- [[${task.path.replace(/\.md$/i, "")}]]\n`,
    };
    fixture = mdbaseFixture([task, linkedScratchpad]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    renderScratchpad();
    await screen.findByRole("button", { name: "Linked task" });
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    const source = await screen.findByRole("textbox", {
      name: "Scratchpad Markdown",
    });
    const editor = EditorView.findFromDOM(source);
    expect(editor).not.toBeNull();
    const tasks = await repository.list({
      status: "all",
      archived: "include",
      limit: 50_000,
    });
    const hydration = deferred<typeof tasks>();
    const list = vi
      .spyOn(repository, "listSummaries")
      .mockReturnValueOnce(hydration.promise);

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    act(() => {
      editor!.dispatch({
        changes: {
          from: editor!.state.doc.length,
          insert: "- Newer Markdown edit\n",
        },
      });
    });
    await act(async () => hydration.resolve(tasks));

    expect(screen.getByRole("button", { name: "Write" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(source).toHaveTextContent("Newer Markdown edit");
  });

  it("resolves a linked task title without rewriting its exact link", async () => {
    const created = await repository.create({ title: "Filename title" });
    const renamed = await repository.update(created.id, {
      title: "Readable title property",
    });
    const scratchpad = await repository.getActiveScratchpad();
    const exactBody = `- [[${renamed.path.replace(/\.md$/i, "")}]]\n`;
    await repository.saveScratchpad({
      id: scratchpad.id,
      path: scratchpad.path,
      revision: scratchpad.revision,
      baseBody: scratchpad.body,
      body: exactBody,
    });

    renderScratchpad();

    expect(
      await screen.findByRole("button", { name: "Readable title property" }),
    ).toBeVisible();
    expect(screen.queryByText("Filename title")).not.toBeInTheDocument();
    expect((await repository.getActiveScratchpad()).body).toBe(exactBody);
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

  it("flushes both notes and resumes history as the focused current note", async () => {
    const original = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: original.id,
      path: original.path,
      revision: original.revision,
      baseBody: original.body,
      body: "- [ ] Historical draft\n",
      title: "Earlier notes",
    });
    const transition = await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
    });

    renderScratchpad();
    const currentInput = await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.change(currentInput, { target: { value: "Current thought" } });
    fireEvent.click(screen.getByRole("button", { name: /Earlier notes/ }));
    const historicalInput = await screen.findByRole("textbox", {
      name: "Draft task: Historical draft",
    });
    fireEvent.change(historicalInput, {
      target: { value: "Resumed historical draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume as current" }));

    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).toBe(saved.id),
    );
    expect(await repository.getActiveScratchpad()).toMatchObject({
      path: saved.path,
      body: "- [ ] Resumed historical draft\n",
      state: "active",
    });
    expect(await repository.getScratchpad(transition.current.id)).toMatchObject(
      {
        state: "converted",
        body: "- [ ] Current thought\n",
        dateConverted: expect.any(String),
      },
    );
    const resumedInput = await screen.findByRole("textbox", {
      name: "Draft task: Resumed historical draft",
    });
    const currentCard = resumedInput.closest(".scratchpad-current-document")!;
    expect(currentCard).not.toBeNull();
    await waitFor(() =>
      expect(currentCard.querySelector("textarea:focus")).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).toBe(
        transition.current.id,
      ),
    );
    expect(await repository.getActiveScratchpad()).toMatchObject({
      body: "- [ ] Current thought\n",
      state: "active",
    });
  });

  async function renderWithEarlierNote() {
    const original = await repository.getActiveScratchpad();
    const { previous } = await repository.startNewScratchpad({
      id: original.id,
      path: original.path,
      revision: original.revision,
      baseBody: original.body,
      body: "- [ ] Historical draft\n",
      title: "Earlier notes",
    });
    const timeouts = vi.spyOn(window, "setTimeout");
    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    await screen.findByRole("button", { name: /Earlier notes/ });
    const requestDeletion = async () => {
      // Only previous notes offer the menu; the current note cannot be deleted.
      fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Delete note" }),
      );
      await screen.findByText("Deleted “Earlier notes”");
    };
    const closeUndoWindow = () =>
      act(async () => {
        const call = timeouts.mock.calls.find(([, delay]) => delay === 30_000);
        expect(call).toBeDefined();
        (call![0] as () => void)();
      });
    return { previous, requestDeletion, closeUndoWindow };
  }

  it("accepts a pending deletion when the screen is left", async () => {
    const { previous, requestDeletion } = await renderWithEarlierNote();

    await requestDeletion();
    leaveScratchpad();

    await waitFor(async () =>
      expect(await repository.getScratchpad(previous.id)).toBeNull(),
    );
  });

  it("returns the note and says so when the collection rejects its deletion", async () => {
    const { previous, requestDeletion } = await renderWithEarlierNote();
    vi.spyOn(repository, "deleteScratchpad").mockRejectedValueOnce(
      new Error("The collection is unavailable."),
    );

    await requestDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The note was not deleted. The collection is unavailable.",
    );
    expect(
      await screen.findByRole("button", { name: /Earlier notes/ }),
    ).toBeVisible();
    expect(await repository.getScratchpad(previous.id)).not.toBeNull();
  });

  it("does not change lifecycle state when a pending note cannot save", async () => {
    const original = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: original.id,
      path: original.path,
      revision: original.revision,
      baseBody: original.body,
      body: "- [ ] Historical draft\n",
      title: "Earlier notes",
    });
    const transition = await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
    });
    const reactivate = vi.spyOn(repository, "reactivateScratchpad");

    renderScratchpad();
    await screen.findByRole(
      "textbox",
      { name: "Draft task: empty" },
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
    fireEvent.click(screen.getByRole("button", { name: /Earlier notes/ }));
    const historicalInput = await screen.findByRole("textbox", {
      name: "Draft task: Historical draft",
    });
    fireEvent.change(historicalInput, {
      target: { value: "Unsaved historical draft" },
    });
    vi.spyOn(repository, "saveScratchpad").mockRejectedValueOnce(
      new Error("Connection unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume as current" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection unavailable",
    );
    expect(reactivate).not.toHaveBeenCalled();
    expect(await repository.getActiveScratchpad()).toMatchObject({
      id: transition.current.id,
      state: "active",
    });
    expect(await repository.getScratchpad(saved.id)).toMatchObject({
      id: saved.id,
      state: "converted",
    });
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
        `[data-feed-key="scratchpad:${saved.id}"] .scratchpad-document-disclosure`,
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
