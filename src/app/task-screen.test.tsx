import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor } from "../test/render";

import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import {
  createTestMdbaseRepository,
  mdbaseFixture,
} from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import { RepositoryProvider } from "./repository-context";
import { historyScope, readHistory } from "./search-history";
import { TaskScreen } from "./task-screen";

import type { Task } from "../domain/task";

describe("TaskScreen", () => {
  let repository: MdbaseTaskRepository;
  let task: Task;

  beforeEach(async () => {
    repository = createTestMdbaseRepository();
    await repository.initialize();
    task = await repository.create({ title: "Keep this draft" });
  });

  function renderTask(onBack = vi.fn()) {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskScreen id={task.id} onBack={onBack} onMaterialized={vi.fn()} />
      </RepositoryProvider>,
    );
    return onBack;
  }

  async function editTitle() {
    const title = await screen.findByLabelText("Task title", { exact: true });
    fireEvent.change(title, { target: { value: "Unsaved important draft" } });
  }

  it("remembers an opened task for Search", async () => {
    renderTask();
    await screen.findByLabelText("Task title", { exact: true });
    const scope = historyScope(await repository.collectionInfo());
    await waitFor(() => expect(readHistory("tasks", scope)).toEqual([task.id]));
    localStorage.clear();
  });

  it("never labels a dirty draft Saved during the autosave debounce", async () => {
    const update = vi.spyOn(repository, "update");
    renderTask();
    await editTitle();
    expect(screen.getByRole("button", { name: "Saving" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Saved" }),
    ).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the editor open when saving before navigation fails", async () => {
    const onBack = renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Task title", { exact: true })).toHaveValue(
      "Unsaved important draft",
    );
  });

  it("does not write assignments when only other fields changed", async () => {
    const update = vi.spyOn(repository, "update");
    const onBack = renderTask();
    await editTitle();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ title: "Unsaved important draft" }),
    );
    expect(
      update.mock.calls.every(([, input]) => !("assignees" in input)),
    ).toBe(true);
  });

  it("completes from the title after preserving pending notes", async () => {
    renderTask();
    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "Keep the reasoning behind this task." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete task" }));
    await screen.findByRole("button", { name: "Reopen task" });
    const saved = await repository.get(task.id);
    expect(saved?.completed).toBe(true);
    expect(saved?.body).toContain("Keep the reasoning behind this task.");
  });

  it("does not complete if the pending draft cannot be saved", async () => {
    renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete task" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect((await repository.get(task.id))?.completed).toBe(false);
    expect(screen.getByLabelText("Task title", { exact: true })).toHaveValue(
      "Unsaved important draft",
    );
  });

  it("does not archive a task after its pending draft fails to save", async () => {
    renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );
    const archive = vi.spyOn(repository, "setArchived");

    fireEvent.click(screen.getByRole("button", { name: "More task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect(archive).not.toHaveBeenCalled();
  });

  it("attaches an image as task membership, then inserts it in Notes explicitly", async () => {
    renderTask();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "receipt.png", {
      type: "image/png",
    });

    fireEvent.change(await screen.findByLabelText("Attach image"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("receipt.png")).toBeVisible();
    const attached = await repository.get(task.id);
    expect(attached?.attachments).toHaveLength(1);
    expect(attached?.frontmatter.attachments).toEqual(attached?.attachments);
    expect(attached?.body).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(async () =>
      expect((await repository.get(task.id))?.body).toMatch(
        /^!\[\[Attachments\//,
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Notes") as HTMLTextAreaElement).value,
      ).toMatch(/^!\[\[Attachments\//),
    );

    expect(
      screen.getByText("Detaching keeps the image file in your collection."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Delete receipt\.png file/ }),
    ).not.toBeInTheDocument();

    const detach = screen.getByRole("button", { name: "Detach receipt.png" });
    await waitFor(() => expect(detach).toBeEnabled());
    fireEvent.click(detach);
    await waitFor(() =>
      expect(screen.queryByText("receipt.png")).not.toBeInTheDocument(),
    );
    expect((await repository.get(task.id))?.attachments).toEqual([]);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

  it("preserves Notes typed while an inline image upload is in flight", async () => {
    renderTask();
    const upload = repository.files!.upload.bind(repository.files);
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const uploadSpy = vi
      .spyOn(repository.files!, "upload")
      .mockImplementationOnce(async (...arguments_) => {
        await uploadGate;
        return upload(...arguments_);
      });
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "slow.png", {
      type: "image/png",
    });

    fireEvent.change(await screen.findByLabelText("Insert in Notes"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(uploadSpy).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Typed while uploading" },
    });
    releaseUpload();

    await waitFor(async () => {
      const saved = await repository.get(task.id);
      expect(saved?.body).toMatch(
        /^Typed while uploading\n\n!\[\[Attachments\//,
      );
    });
    expect(
      (screen.getByLabelText("Notes") as HTMLTextAreaElement).value,
    ).toMatch(/^Typed while uploading\n\n!\[\[Attachments\//);
  });

  it("preserves Notes typed while existing-image validation is in flight", async () => {
    renderTask();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "existing.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("Attach image"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("existing.png")).toBeVisible();

    const list = repository.files!.list.bind(repository.files);
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listSpy = vi
      .spyOn(repository.files!, "list")
      .mockImplementationOnce(async (...arguments_) => {
        await listGate;
        return list(...arguments_);
      });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Typed during validation" },
    });
    releaseList();

    await waitFor(async () =>
      expect((await repository.get(task.id))?.body).toMatch(
        /^Typed during validation\n\n!\[\[Attachments\//,
      ),
    );
  });

  it("opens a blank image window synchronously and reports download failures", async () => {
    renderTask();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "open.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("Attach image"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("open.png")).toBeVisible();

    const target = {
      close: vi.fn(),
      location: { href: "about:blank" },
      opener: window,
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(target);
    const download = vi
      .spyOn(repository.files!, "download")
      .mockRejectedValueOnce(new Error("Image download unavailable"));

    fireEvent.click(screen.getByRole("button", { name: "Open open.png" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(download).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Image download unavailable",
      ),
    );
    expect(target.close).toHaveBeenCalled();
  });

  it("keeps a user-opened window alive across a delayed image download", async () => {
    renderTask();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "delayed.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("Attach image"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("delayed.png")).toBeVisible();

    const target = {
      close: vi.fn(),
      location: { href: "about:blank" },
      opener: window,
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(target);
    const download = repository.files!.download.bind(repository.files);
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    vi.spyOn(repository.files!, "download").mockImplementationOnce(
      async (...arguments_) => {
        await downloadGate;
        return download(...arguments_);
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Open delayed.png" }));
    expect(target.location.href).toBe("about:blank");
    releaseDownload();
    await waitFor(() => expect(target.location.href).toMatch(/^blob:/));
    expect(target.close).not.toHaveBeenCalled();
  });
});

describe("TaskScreen with a change made in another tab", () => {
  let fixture: ReturnType<typeof mdbaseFixture>;
  let repository: MdbaseTaskRepository;
  let task: Task;

  beforeEach(async () => {
    fixture = mdbaseFixture([]);
    repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    task = await repository.create({ title: "Alpha" });
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskScreen id={task.id} onBack={vi.fn()} onMaterialized={vi.fn()} />
      </RepositoryProvider>,
    );
  });

  async function saveFromAnotherTab(input: { title: string; body?: string }) {
    const otherTab = new MdbaseTaskRepository(fixture.connect);
    await otherTab.initialize();
    await otherTab.update(task.id, input);
    // The collection reports the other tab's change to this tab.
    await act(async () => void (await repository.refresh()));
  }

  it("shows a title changed elsewhere after this tab saved its own", async () => {
    const title = await screen.findByLabelText("Task title", { exact: true });
    fireEvent.change(title, { target: { value: "Beta" } });
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Saved" })).toBeVisible(),
      { timeout: 3_000 },
    );

    await saveFromAnotherTab({ title: "Gamma" });

    await waitFor(() => expect(title).toHaveValue("Gamma"));
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
  });

  it("keeps a title being edited and shows other fields changed elsewhere", async () => {
    const title = await screen.findByLabelText("Task title", { exact: true });
    fireEvent.change(title, { target: { value: "My unsaved title" } });

    await saveFromAnotherTab({ title: "Gamma", body: "Notes from elsewhere" });

    await waitFor(() =>
      expect(screen.getByLabelText("Notes")).toHaveValue(
        "Notes from elsewhere",
      ),
    );
    expect(title).toHaveValue("My unsaved title");
  });
});

describe("TaskScreen with a refused native save", () => {
  let f: Awaited<ReturnType<typeof nextTaskFixture>>;
  afterEach(() => f.close());

  async function rejectedNotesEdit(
    problem?: Parameters<typeof f.replica.reject>[1],
  ) {
    f = await nextTaskFixture({ confirmDelayMs: null });
    await f.repository.initialize();
    const task = await f.repository.create({ title: "Shared task" });
    f.replica.confirmAll();
    const update = vi.spyOn(f.client, "update");
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={f.repository}
      >
        <TaskScreen id={task.id} onBack={vi.fn()} onMaterialized={vi.fn()} />
      </RepositoryProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "My local notes" },
    });
    await waitFor(() => expect(update).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });
    const record = f.replica.allRecords.find((r) => r.path === task.path)!;
    f.replica.reject(update.mock.calls[0]![2]!.mutationId!, problem);
    // Another app's newer version arrives after the refusal.
    f.replica.seed({
      id: record.id,
      path: record.path,
      types: record.types,
      frontmatter: Object.fromEntries(record.frontmatter),
      body: "Edited elsewhere",
    });
    return { update, recordId: record.id };
  }

  it("keeps the draft and re-applies it on the latest revision only when asked", async () => {
    const { update, recordId } = await rejectedNotesEdit();
    expect(
      await screen.findByText(
        "This task changed somewhere else, so your edit wasn't saved.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Notes")).toHaveValue("My local notes");
    expect(
      screen.getByRole("button", { name: "Not saved. Review your edit." }),
    ).toBeEnabled();
    // Further typing never silently overwrites the other app's change.
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "My local notes, extended" },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(update).toHaveBeenCalledOnce();

    const latest = await f.client.get(recordId, { body: true });
    fireEvent.click(screen.getByRole("button", { name: "Keep my edit" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![1]).toMatchObject({
      body: "My local notes, extended",
      ifRevision: latest.revision,
    });
    f.replica.confirmAll();
    await waitFor(() =>
      expect(
        screen.queryByRole("alert", { name: "Edit not saved" }),
      ).not.toBeInTheDocument(),
    );
    expect((await f.client.get(recordId, { body: true })).body).toBe(
      "My local notes, extended",
    );
  });

  it("shows other refusals without offering to re-apply, and discards to the latest", async () => {
    const { update } = await rejectedNotesEdit({
      code: "invalid_record",
      recovery: "fix_request",
      message: "Notes are too long.",
    });
    expect(await screen.findByText("Notes are too long.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Keep my edit" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard my edit" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("alert", { name: "Edit not saved" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Edited elsewhere");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(update).toHaveBeenCalledOnce();
  });
});
