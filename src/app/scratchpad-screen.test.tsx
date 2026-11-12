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
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordMatchesLink } from "../domain/completion";
import { toPlain } from "@mdbase-dev/sdk";
import type { NextTaskRepository } from "../storage/next-repository";
import {
  attachTaskNotes,
  nextTaskFixture,
  seedRecord,
  seedTask,
  taskQueryWhere,
} from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { ScratchpadScreen } from "./scratchpad-screen";

const SCRATCHPAD_LOAD_TIMEOUT = 5_000;

describe("ScratchpadScreen", () => {
  let fixture: Awaited<ReturnType<typeof nextTaskFixture>>;
  let repository: NextTaskRepository;

  beforeEach(async () => {
    localStorage.clear();
    fixture = await nextTaskFixture({ where: taskQueryWhere });
    ({ repository } = fixture);
    await repository.initialize();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fixture.close();
  });

  /** Replace the collection with one holding records another app wrote. */
  async function reopenWith(seed: (replica: typeof fixture.replica) => void) {
    fixture.close();
    fixture = await nextTaskFixture({ where: taskQueryWhere });
    seed(fixture.replica);
    ({ repository } = fixture);
    await repository.initialize();
  }

  function storedRecords() {
    return fixture.replica.allRecords.map((record) => ({
      body: record.body,
      frontmatter: Object.fromEntries(
        [...record.frontmatter].map(([field, value]) => [
          field,
          toPlain(value),
        ]),
      ),
    }));
  }

  const scratchpadRecord = (body: string) => ({
    path: "scratchpads/Scratchpad.md",
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id: "current",
      state: "active",
      dateCreated: "2026-08-31T00:00:00.000Z",
      dateModified: "2026-08-31T00:00:00.000Z",
    },
    body,
  });

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

  const WAIT = { timeout: SCRATCHPAD_LOAD_TIMEOUT };

  /** The outline editor inside one note. */
  async function outlineIn(note: HTMLElement) {
    const box = await within(note).findByRole(
      "textbox",
      { name: "Scratchpad outline" },
      WAIT,
    );
    const view = EditorView.findFromDOM(box);
    if (!view) throw new Error("The outline editor did not start.");
    return view;
  }

  async function noteRegion(name: string) {
    return screen.findByRole("region", { name: `Editor for ${name}` }, WAIT);
  }

  /** The current note's editor, once the note has loaded. */
  async function currentOutline() {
    return outlineIn(await noteRegion("current scratchpad"));
  }

  /** Replace the note's text, as typing it would, with the caret at its end. */
  function write(view: EditorView, text: string) {
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
        userEvent: "input",
      });
    });
  }

  const written = (view: EditorView) => view.state.doc.toString();

  const pause = (ms: number) =>
    act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

  it("starts an empty note on a draft and offers each written draft as a task", async () => {
    await reopenWith((replica) => {
      seedRecord(
        replica,
        scratchpadRecord("- [ ] Parent\n  - [ ] Child\n- A plain point\n"),
      );
    });
    renderScratchpad();
    const view = await currentOutline();
    expect(written(view)).toBe("- [ ] Parent\n  - [ ] Child\n- A plain point");
    expect(
      screen.getByRole("button", { name: "Create task for Parent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create task for Child" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create task for A plain point" }),
    ).toBeNull();
    // Neither a second editor nor a way to switch to one.
    expect(screen.queryByRole("button", { name: "Write" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Outline" })).toBeNull();

    cleanup();
    await reopenWith(() => undefined);
    renderScratchpad();
    expect(written(await currentOutline())).toBe("- [ ] ");
    expect((await repository.getActiveScratchpad()).body).toBe("");
  });

  it("steps out of the list when Enter is pressed on an empty item", async () => {
    renderScratchpad();
    const view = await currentOutline();
    const enter = () =>
      act(() => {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        runScopeHandlers(
          view,
          new KeyboardEvent("keydown", { key: "Enter" }),
          "editor",
        );
      });
    write(view, "- [ ] Parent\n  - [ ] Child\n  - [ ] ");
    enter();
    expect(written(view)).toBe("- [ ] Parent\n  - [ ] Child\n- [ ] ");
    // At the top level an empty line is left to write on freely.
    enter();
    expect(written(view)).toBe("- [ ] Parent\n  - [ ] Child\n\n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("distinguishes native note pending metadata from authority Saved (component port stand-in)", async () => {
    const current = await repository.getActiveScratchpad();
    const writeState = vi.fn(() => "pending" as const);
    Object.assign(repository, { writeState });
    renderScratchpad();
    await currentOutline();
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
    const view = await currentOutline();
    write(view, "- [ ] Retained original text");
    await screen.findByText("Save needs review");
    expect(screen.getByText("Save outcome unknown")).toBeVisible();
    expect(save).toHaveBeenCalledOnce();
    expect(written(view)).toBe("- [ ] Retained original text");
  });

  it("converts a checked draft as a completed task in one write", async () => {
    const create = vi.spyOn(repository, "create");
    const update = vi.spyOn(repository, "update");
    renderScratchpad();
    const view = await currentOutline();
    write(view, "- [x] Publish the release");

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
    const view = await currentOutline();
    const updateOp = vi.spyOn(fixture.client, "updateOp");

    write(view, "- [ ] Draft [[Plan");

    // The first save creates the note.
    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Draft [[Plan\n",
      });
      expect(screen.getByText("Saved")).toBeVisible();
    });
    expect(updateOp).not.toHaveBeenCalled();

    write(view, "- [ ] Draft [[Plan]]");

    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Draft [[Plan]]\n",
      });
      expect(updateOp).toHaveBeenCalledOnce();
    });
    expect(updateOp).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ body: "- [ ] Draft [[Plan]]\n" }),
    );
    expect(screen.queryByText("Not saved")).toBeNull();
  });

  it("does not save a note for the empty item it ends on", async () => {
    renderScratchpad();
    const view = await currentOutline();
    const save = vi.spyOn(repository, "saveScratchpad");

    write(view, "- [ ] Keep this\n- [ ] ");
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toBe(
        "- [ ] Keep this\n",
      ),
    );
    expect(save).toHaveBeenCalledOnce();

    write(view, "- [ ] Keep this\n- [ ] \n");
    await pause(400);
    expect(save).toHaveBeenCalledOnce();
  });

  it("saves headings, tables and prose beside the outline as written", async () => {
    renderScratchpad();
    const view = await currentOutline();
    const body =
      "## Planning\n\nSome context first.\n\n- [ ] Book the room\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    write(view, body);

    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toBe(`${body}\n`),
    );
    expect(
      screen.getByRole("button", { name: "Create task for Book the room" }),
    ).toBeInTheDocument();
  });

  it("shows a generic autosave rejection and clears it after recovery", async () => {
    renderScratchpad();
    const view = await currentOutline();
    vi.spyOn(repository, "saveScratchpad").mockRejectedValueOnce(
      new Error("Temporary save failure"),
    );

    write(view, "- [ ] First attempt");

    expect(await screen.findByText("Not saved")).toBeVisible();
    expect(screen.getByText("Temporary save failure")).toBeVisible();

    write(view, "- [ ] Recovered draft");

    await waitFor(async () => {
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body: "- [ ] Recovered draft\n",
      });
      expect(screen.getByText("Saved")).toBeVisible();
    });
    expect(screen.queryByText("Temporary save failure")).toBeNull();
  });

  it("shows the task on a line that comes to link one, above its children", async () => {
    cleanup();
    let path = "";
    await reopenWith((replica) => {
      path = seedTask(
        replica,
        { title: "Suggested task" },
        { id: "suggested" },
      ).path;
    });
    renderScratchpad();
    const view = await currentOutline();
    const link = `[[${path.replace(/\.md$/i, "")}|Suggested task]]`;
    write(view, `- ${link}\n  - [ ] Child`);

    await screen.findByRole("button", { name: "Suggested task" }, WAIT);
    expect(
      screen.getByRole("button", { name: "Create task for Child" }),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).body).toBe(
        `- ${link}\n  - [ ] Child\n`,
      ),
    );
  });

  it("keeps an exact non-task record link as editable note text", async () => {
    cleanup();
    await reopenWith((replica) => {
      seedRecord(replica, {
        path: "Projects/Plan.md",
        types: ["project"],
        frontmatter: { title: "Project plan" },
        body: "",
      });
      seedTask(replica, { title: "Actual task" }, { id: "task" });
      seedRecord(
        replica,
        scratchpadRecord("- [[Projects/Plan|Project plan]]\n"),
      );
    });

    renderScratchpad();

    const view = await currentOutline();
    expect(written(view)).toBe("- [[Projects/Plan|Project plan]]");
    // Long enough for the link to have been looked up.
    await pause(700);
    expect(document.querySelector(".cm-scratch-chip")).toBeNull();
    expect((await repository.getActiveScratchpad()).body).toBe(
      "- [[Projects/Plan|Project plan]]\n",
    );
  });

  it("does not resolve a basename-only non-task link to a task in another folder", async () => {
    cleanup();
    await reopenWith((replica) => {
      seedTask(
        replica,
        { title: "Task plan" },
        { id: "task", path: "tasks/Plan.md" },
      );
      seedRecord(replica, scratchpadRecord("- [[Plan]]\n"));
    });

    renderScratchpad();

    expect(written(await currentOutline())).toBe("- [[Plan]]");
    await pause(700);
    expect(screen.queryByRole("button", { name: "Task plan" })).toBeNull();
    expect(document.querySelector(".cm-scratch-chip")).toBeNull();
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
    // Another tab is another client on the same device replica.
    const { repository: otherTab, close } = await attachTaskNotes(
      fixture.replica,
      undefined,
      { accountId: fixture.accountId },
    );
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
    close();
    // The collection reports the other tab's change to this tab.
    await act(async () => void (await repository.refresh()));
  }

  it("opens a fresh collection without writing; the first edit stores the note", async () => {
    const submit = vi.spyOn(fixture.client, "submit");
    renderScratchpad();
    const view = await currentOutline();
    await pause(100);
    // On a fresh browser any write before connecting is work to bring in.
    expect(submit).not.toHaveBeenCalled();
    expect(storedRecords()).toEqual([]);

    write(view, "- [ ] First");
    await waitFor(() =>
      expect(storedRecords()).toEqual([
        expect.objectContaining({ body: "- [ ] First\n" }),
      ]),
    );
    expect(screen.queryByText("Not saved")).toBeNull();
  });

  it("shows a note title changed in another tab", async () => {
    const unsaved = await repository.getActiveScratchpad();
    await repository.saveScratchpad({
      id: unsaved.id,
      path: unsaved.path,
      revision: unsaved.revision,
      baseBody: "",
      body: "",
    });
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

  it("releases bottom pinning when image capture is explicitly opened", async () => {
    let notifyResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: () => void) {}
        observe(element: Element) {
          if (element.classList.contains("scratchpad-history-scroll"))
            notifyResize = this.callback;
        }
        unobserve() {}
        disconnect() {}
      },
    );
    renderScratchpad();
    await currentOutline();
    const scroller = document.querySelector<HTMLElement>(
      ".scratchpad-history-scroll",
    )!;
    Object.defineProperty(scroller, "scrollHeight", { value: 1200 });
    act(() => notifyResize());
    expect(scroller.scrollTop).toBe(1200);
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    scroller.scrollTop = 300;
    act(() => notifyResize());
    expect(scroller.scrollTop).toBe(300);
  });

  it("opens an accessible image capture panel and retains it after an invalid drop", async () => {
    renderScratchpad();
    await currentOutline();

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
    await currentOutline();
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "upload.png",
      { type: "image/png" },
    );

    fireEvent.change(screen.getByLabelText("Upload images"), {
      target: { files: [image, image] },
    });

    await screen.findByText(
      "Image added",
      {},
      { timeout: SCRATCHPAD_LOAD_TIMEOUT },
    );
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
    await currentOutline();
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

  it("handles image-only paste anywhere on the surface as an image of its own", async () => {
    mockVerifiedImageUpload();
    renderScratchpad();
    const view = await currentOutline();
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "paste.png",
      { type: "image/png" },
    );
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
        getData: () => "",
      },
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await screen.findByText("Image added");
    expect((await repository.listScratchFeed()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "image", size: image.size }),
      ]),
    );
    expect((await repository.getActiveScratchpad()).body).toBe("");
  });

  it("creates the only draft without asking which", async () => {
    renderScratchpad();
    const view = await currentOutline();
    write(view, "## Notes\n\n- [ ] Portable draft");
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    await screen.findByText("Created “Portable draft”");
    expect(screen.queryByRole("dialog", { name: "Create tasks" })).toBeNull();
    const body = (await repository.getActiveScratchpad()).body;
    expect(body).toMatch(
      /^## Notes\n\n- \[\[tasks\/[^\]]+\|Portable draft\]\]\n$/,
    );
    // The next draft is ready under the new task, and is not saved while empty.
    expect(written(view)).toMatch(/\]\]\n- \[ \] $/);
    await screen.findByRole("button", { name: "Portable draft" });
  });

  it("leaves the list as it is when a draft in the middle becomes a task", async () => {
    renderScratchpad();
    const view = await currentOutline();
    write(view, "- [ ] First\n- [ ] Second");
    fireEvent.click(
      screen.getByRole("button", { name: "Create task for First" }),
    );
    await screen.findByText("Created “First”");
    expect(written(view)).toMatch(
      /^- \[\[tasks\/[^\]]+\|First\]\]\n- \[ \] Second$/,
    );
  });

  it("resolves a linked task title without rewriting its exact link", async () => {
    const created = await repository.create({ title: "Filename title" });
    const renamed = await repository.update(created.id, {
      title: "Readable title property",
      scheduled: "2099-11-06",
      priority: "high",
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

    await screen.findByRole(
      "button",
      { name: "Readable title property" },
      WAIT,
    );
    expect(screen.queryByText("Filename title")).not.toBeInTheDocument();
    await waitFor(() => {
      const metadata = document.querySelector(".cm-scratch-task-details")!;
      expect(metadata).toHaveTextContent(/Nov/);
      expect(metadata).toHaveTextContent(/high/i);
    });
    expect((await repository.getActiveScratchpad()).body).toBe(exactBody);
  });

  it("opens a linked task from its title and completes it from its mark", async () => {
    const task = await repository.create({ title: "Linked task" });
    const scratchpad = await repository.getActiveScratchpad();
    const body = `- [[${task.path.replace(/\.md$/i, "")}]]\n`;
    await repository.saveScratchpad({
      ...scratchpad,
      baseBody: scratchpad.body,
      body,
    });
    const openTask = renderScratchpad();

    fireEvent.click(
      await screen.findByRole("button", { name: "Linked task" }, WAIT),
    );
    await waitFor(() =>
      expect(openTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id }),
      ),
    );

    const mark = await screen.findByRole("checkbox", { name: "Linked task" });
    expect(mark).toHaveAttribute("aria-checked", "false");
    fireEvent.click(mark);
    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({ completed: true }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Linked task" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    expect((await repository.getActiveScratchpad()).body).toBe(body);
  });

  it("refreshes a linked task renamed in another tab without rewriting the note", async () => {
    const task = await repository.create({ title: "Original linked title" });
    const scratchpad = await repository.getActiveScratchpad();
    const body = `- [[${task.path.replace(/\.md$/i, "")}#Heading|Preserved alias]]\n`;
    const saved = await repository.saveScratchpad({
      ...scratchpad,
      baseBody: scratchpad.body,
      body,
    });
    renderScratchpad();
    await screen.findByRole("button", { name: task.title }, WAIT);
    const otherTab = await attachTaskNotes(fixture.replica, undefined, {
      accountId: fixture.accountId,
    });
    try {
      await otherTab.repository.initialize();
      await act(async () => {
        await otherTab.repository.update(task.id, {
          title: "Renamed in another tab",
        });
        await repository.refresh();
      });
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: "Renamed in another tab",
          }),
        ).toBeInTheDocument(),
      );
      expect(await repository.getActiveScratchpad()).toMatchObject({
        body,
        revision: saved.revision,
      });
    } finally {
      otherTab.close();
    }
  });

  it("converts only selected drafts and leaves the rest active", async () => {
    const openTask = renderScratchpad();
    const view = await currentOutline();
    write(view, "- [ ] Plan launch\n  - [ ] Write announcement");

    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    const dialog = screen.getByRole("dialog", { name: "Create tasks" });
    // The draft being written is the one already chosen.
    expect(dialog).toHaveTextContent("1 of 2 selected");
    expect(
      screen.getByRole("checkbox", { name: "Write announcement" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Write announcement" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Plan launch" }));
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
      storedRecords().filter(
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
    const view = await currentOutline();
    write(
      view,
      "- [ ] Plan launch\n  - [ ] Write announcement\n  - Keep the tone straightforward",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    expect(
      screen.getByRole("dialog", { name: "Create tasks" }),
    ).toHaveTextContent("0 of 2 selected");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
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

    const previous = await repository.getActiveScratchpad();
    expect(previous.body).toContain("Keep the tone straightforward");
    expect(previous.body.match(/\[\[tasks\//g)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(previous.id),
    );
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument();
    const preserved = storedRecords().find(
      (record) => record.frontmatter.id === previous.id,
    );
    expect(preserved?.body).toContain("Keep the tone straightforward");
    expect(preserved?.body).toContain("[[tasks/");
  });

  it("starts a new note without creating tasks", async () => {
    renderScratchpad();
    const view = await currentOutline();
    await waitFor(() => expect(view.contentDOM).toHaveFocus());
    write(view, "- [ ] An idea for later");
    const previous = await repository.getActiveScratchpad();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(previous.id),
    );
    expect(await repository.list({ status: "all" })).toHaveLength(0);
    expect((await repository.getActiveScratchpad()).body).toBe("");
    await waitFor(async () => {
      const next = await currentOutline();
      expect(next).not.toBe(view);
      expect(written(next)).toBe("- [ ] ");
      expect(next.contentDOM).toHaveFocus();
    });
    const preserved = storedRecords().find(
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
    const view = await currentOutline();
    write(view, "- [ ] First task\n- [ ] Second task");
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
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

  /** A saved earlier note, titled so its line can be found by name. */
  async function startAfterEarlierNote() {
    const original = await repository.getActiveScratchpad();
    const saved = await repository.saveScratchpad({
      id: original.id,
      path: original.path,
      revision: original.revision,
      baseBody: original.body,
      body: "- [ ] Historical draft\n",
      title: "Research notes",
    });
    const transition = await repository.startNewScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
    });
    return { saved, transition };
  }

  it("opens an earlier note on its own line, saves it and closes it again", async () => {
    const { saved } = await startAfterEarlierNote();

    renderScratchpad();
    const currentView = await currentOutline();
    const row = screen.getByRole("button", { name: /Research notes/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    const currentEditor = await noteRegion("current scratchpad");
    expect(
      row.compareDocumentPosition(currentEditor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(row);

    const earlier = await noteRegion("Research notes");
    const earlierView = await outlineIn(earlier);
    expect(written(earlierView)).toBe("- [ ] Historical draft");
    // The opened note is one line: its name, one action, and the way back.
    expect(screen.queryByRole("button", { name: /Research notes/ })).toBeNull();
    expect(
      within(earlier).getByRole("textbox", { name: "Note title" }),
    ).toHaveValue("Research notes");
    expect(
      within(earlier).getByRole("button", { name: "Resume as current" }),
    ).toBeEnabled();
    expect(currentView.dom).toBeInTheDocument();

    write(earlierView, "- [ ] Edited historical draft");
    fireEvent.click(within(earlier).getByRole("button", { name: "Collapse" }));

    await waitFor(async () =>
      expect((await repository.getScratchpad(saved.id))?.body).toContain(
        "Edited historical draft",
      ),
    );
    expect(
      await screen.findByRole("button", { name: /Research notes/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("region", { name: "Editor for Research notes" }),
    ).toBeNull();
  });

  it("flushes both notes and resumes history as the focused current note", async () => {
    const { saved, transition } = await startAfterEarlierNote();

    renderScratchpad();
    write(await currentOutline(), "- [ ] Current thought");
    fireEvent.click(screen.getByRole("button", { name: /Research notes/ }));
    const earlier = await noteRegion("Research notes");
    write(await outlineIn(earlier), "- [ ] Resumed historical draft");
    fireEvent.click(
      within(earlier).getByRole("button", { name: "Resume as current" }),
    );

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
    await waitFor(() => {
      const card = document.querySelector(".scratchpad-current-document")!;
      const content = card.querySelector<HTMLElement>(".cm-content")!;
      expect(content).toHaveTextContent("Resumed historical draft");
      expect(content).toHaveFocus();
    });

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

  it("scrolls up to earlier notes from the heading", async () => {
    await startAfterEarlierNote();
    renderScratchpad();
    await currentOutline();
    const scroller = document.querySelector<HTMLElement>(
      ".scratchpad-history-scroll",
    )!;
    const scrollBy = vi.fn();
    Object.assign(scroller, { scrollBy });
    Object.defineProperty(scroller, "clientHeight", { value: 500 });

    fireEvent.click(screen.getByRole("button", { name: "Earlier notes" }));

    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: -300 }),
    );
  });

  it("offers no way to earlier notes when there are none", async () => {
    renderScratchpad();
    await currentOutline();
    expect(screen.queryByRole("button", { name: "Earlier notes" })).toBeNull();
  });

  async function renderWithEarlierNote() {
    const original = await repository.getActiveScratchpad();
    const { previous } = await repository.startNewScratchpad({
      id: original.id,
      path: original.path,
      revision: original.revision,
      baseBody: original.body,
      body: "- [ ] Historical draft\n",
      title: "Research notes",
    });
    const timeouts = vi.spyOn(window, "setTimeout");
    renderScratchpad();
    await currentOutline();
    await screen.findByRole("button", { name: /Research notes/ });
    const requestDeletion = async () => {
      // Only previous notes offer the menu; the current note cannot be deleted.
      fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Delete note" }),
      );
      await screen.findByText("Deleted “Research notes”");
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
      await screen.findByRole("button", { name: /Research notes/ }),
    ).toBeVisible();
    expect(await repository.getScratchpad(previous.id)).not.toBeNull();
  });

  it("does not change lifecycle state when a pending note cannot save", async () => {
    const { saved, transition } = await startAfterEarlierNote();
    const reactivate = vi.spyOn(repository, "reactivateScratchpad");

    renderScratchpad();
    await currentOutline();
    fireEvent.click(screen.getByRole("button", { name: /Research notes/ }));
    const earlier = await noteRegion("Research notes");
    write(await outlineIn(earlier), "- [ ] Unsaved historical draft");
    vi.spyOn(repository, "saveScratchpad").mockRejectedValueOnce(
      new Error("Connection unavailable"),
    );
    fireEvent.click(
      within(earlier).getByRole("button", { name: "Resume as current" }),
    );

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

  it("preserves opened history and images across new notes and reloads", async () => {
    const { saved } = await startAfterEarlierNote();
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
    const earlierNote = () =>
      document.querySelector<HTMLElement>(
        `[data-feed-key="scratchpad:${saved.id}"]`,
      )!;

    renderScratchpad();
    await currentOutline();
    await waitFor(() =>
      expect(localStorage.getItem(storageKey)).not.toBeNull(),
    );
    // An image is a line until it is opened.
    const image = screen.getByRole("button", { name: "Expand image" });
    expect(image).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".scratch-image-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Research notes/ }));
    fireEvent.click(image);
    expect(
      screen.getByRole("button", { name: "Collapse image" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".scratch-image-frame")).not.toBeNull();

    const activeBefore = await repository.getActiveScratchpad();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(async () =>
      expect((await repository.getActiveScratchpad()).id).not.toBe(
        activeBefore.id,
      ),
    );
    expect(earlierNote()).toHaveClass("is-expanded");
    expect(
      screen.getByRole("button", { name: "Collapse image" }),
    ).toBeVisible();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      expect(stored.expandedDocuments).toContain(saved.id);
      expect(stored.expandedImages).toContain("persistent-image");
    });

    cleanup();
    renderScratchpad();
    await currentOutline();
    await waitFor(() => expect(earlierNote()).toHaveClass("is-expanded"));
    expect(
      screen.getByRole("button", { name: "Collapse image" }),
    ).toBeVisible();
  });

  it("collapses history without a storage error while its editor is loading", async () => {
    const { saved } = await startAfterEarlierNote();
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
    await currentOutline();
    fireEvent.click(screen.getByRole("button", { name: /Research notes/ }));
    const earlierNote = document.querySelector<HTMLElement>(
      `[data-feed-key="scratchpad:${saved.id}"]`,
    )!;
    expect(earlierNote).toHaveClass("is-expanded");
    fireEvent.click(
      await within(earlierNote).findByRole("button", { name: "Collapse" }),
    );

    await waitFor(() => expect(earlierNote).toHaveClass("is-collapsed"));
    expect(
      screen.queryByText("Scratchpad storage is unavailable."),
    ).not.toBeInTheDocument();
    await act(async () => {
      releaseHistory();
      await historyBlocked;
    });
  });

  it.each([false, true])(
    "safely undoes a single conversion with later task edits: %s",
    async (changed) => {
      const create = vi.spyOn(repository, "create");
      renderScratchpad();
      const view = await currentOutline();
      write(view, "- [ ] Recover this draft");
      fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
      await screen.findByText("Created “Recover this draft”");
      expect(screen.queryByRole("dialog", { name: "Create tasks" })).toBeNull();
      const created = await create.mock.results[0]!.value;
      if (changed)
        await act(async () => {
          await repository.update(created.id, {
            title: "Edited after conversion",
          });
        });
      // Writing carries on in the draft left ready under the new task.
      expect(written(view)).toMatch(/\n- \[ \] $/);
      write(view, `${written(view)}Later note edit`);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await screen.findByText(
        changed
          ? "Some tasks or notes changed after conversion. They were kept; their drafts were not restored."
          : "Conversion undone",
      );
      const current = await repository.get(created.id);
      const note = await repository.getActiveScratchpad();
      expect(note.body).toContain("- [ ] Later note edit");
      if (changed) {
        expect(current?.title).toBe("Edited after conversion");
        expect(note.body).toContain("[[tasks/");
        expect(written(view)).not.toContain("- [ ] Recover this draft");
      } else {
        expect(current).toBeNull();
        expect(note.body).toContain("- [ ] Recover this draft");
        expect(note.body).not.toContain("[[tasks/");
        expect(written(view)).toBe(
          "- [ ] Recover this draft\n- [ ] Later note edit",
        );
      }
    },
  );

  it("creates a fresh task when a restored draft is converted again", async () => {
    const create = vi.spyOn(repository, "create");
    renderScratchpad();
    write(await currentOutline(), "- [ ] Convert again");
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    await screen.findByText("Created “Convert again”");
    const first = await create.mock.results[0]!.value;
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Conversion undone");
    expect(await repository.get(first.id)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    await screen.findByText("Created “Convert again”");
    const second = await create.mock.results[1]!.value;
    expect(second.id).not.toBe(first.id);
    expect(await repository.get(second.id)).toMatchObject({
      title: "Convert again",
    });
  });

  it("suspends a pending autosave as soon as single-draft conversion begins", async () => {
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
    const view = await currentOutline();
    vi.useFakeTimers();
    write(view, "- [ ] Plan launch");
    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));

    await act(async () => vi.advanceTimersByTimeAsync(320));
    const savesBeforeRelease = saveScratchpad.mock.calls.length;
    vi.useRealTimers();
    expect(savesBeforeRelease).toBe(0);

    releaseCreate();
    await screen.findByText("Created “Plan launch”");
    expect((await repository.getActiveScratchpad()).body).toContain("[[tasks/");
  });
});
