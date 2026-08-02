import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { TaskScreen } from "./task-screen";

import type { Task } from "../domain/task";

describe("TaskScreen", () => {
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;
  let task: Task;

  beforeEach(async () => {
    index = new TaskIndex(`task-screen-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    });
    await repository.initialize();
    task = await repository.create({ title: "Keep this draft" });
  });

  afterEach(async () => {
    index.close();
    await index.delete();
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

  it("does not archive a task after its pending draft fails to save", async () => {
    renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );
    const archive = vi.spyOn(repository, "setArchived");

    fireEvent.click(screen.getByRole("button", { name: "More task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive task" }));

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
      screen.getByText(
        /Detaching removes an image from this task but keeps the file in your collection\. Permanent deletion isn.t available yet\./,
      ),
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
