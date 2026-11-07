import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import { nextTaskFixture } from "../test/next-task-fixture";
import { AttachmentService } from "../application/attachments/attachment-service";
import { TaskAttachments } from "./task-attachments";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const { repository } = await nextTaskFixture();
  await repository.initialize();
  const task = await repository.create({ title: "Files" });
  const service = new AttachmentService(repository);
  const beforeMutation = vi.fn(async () => undefined);
  const onInsertInline = vi.fn(async () => undefined);
  return { repository, task, service, beforeMutation, onInsertInline };
}

describe("TaskAttachments", () => {
  it("offers unrestricted file selection but keeps the inline picker image-only", async () => {
    const setup = await fixture();
    render(<TaskAttachments {...setup} store={setup.repository.files!} />);
    expect(screen.getByLabelText("Attach file")).not.toHaveAttribute("accept");
    expect(screen.getByLabelText("Insert in Notes")).toHaveAttribute(
      "accept",
      expect.stringContaining("image/png"),
    );
    fireEvent.change(screen.getByLabelText("Attach file"), {
      target: { files: [new File([], "empty-file.txt")] },
    });
    const row = (await screen.findByText("empty-file.txt")).closest("li")!;
    expect(within(row).getByText("0 B")).toBeVisible();
    expect(
      within(row).getByRole("button", { name: "Download empty-file.txt" }),
    ).toBeVisible();
    expect(within(row).queryByRole("button", { name: /^Insert$/ })).toBeNull();
    expect(row.querySelector("img")).toBeNull();
    expect(setup.beforeMutation).toHaveBeenCalledOnce();
    expect(setup.onInsertInline).not.toHaveBeenCalled();
  });

  it.each(["html", "svg"])(
    "does not fetch or preview %s in the thumbnail and reports download failures",
    async (extension) => {
      const setup = await fixture();
      const result = await setup.service.attachFile(
        setup.task.id,
        new File(["untrusted"], `unsafe.${extension}`, {
          type: "image/svg+xml",
        }),
      );
      const download = vi
        .spyOn(setup.repository.files!, "download")
        .mockRejectedValue(new Error("Read unavailable"));
      render(
        <TaskAttachments
          {...setup}
          task={result.task}
          store={setup.repository.files!}
        />,
      );
      const row = (await screen.findByText(`unsafe.${extension}`)).closest(
        "li",
      )!;
      expect(row.querySelector("img")).toBeNull();
      expect(download).not.toHaveBeenCalled();
      fireEvent.click(
        within(row).getByRole("button", {
          name: `Download unsafe.${extension}`,
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Read unavailable",
      );
      await waitFor(() =>
        expect(
          within(row).getByRole("button", {
            name: `Download unsafe.${extension}`,
          }),
        ).toBeEnabled(),
      );
      expect(download).toHaveBeenCalledOnce();
    },
  );

  it("keeps a failed download visible when a held background refresh succeeds", async () => {
    const setup = await fixture();
    const result = await setup.service.attachFile(
      setup.task.id,
      new File(["text"], "notes.txt"),
    );
    const resolved = await setup.service.resolve(result.task);
    const props = {
      ...setup,
      task: result.task,
      store: setup.repository.files!,
    };
    const { rerender } = render(<TaskAttachments {...props} />);
    await screen.findByText("notes.txt");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi
      .spyOn(setup.service, "resolve")
      .mockImplementationOnce(async () => {
        await held;
        return resolved;
      });
    rerender(<TaskAttachments {...props} task={{ ...result.task }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    vi.spyOn(setup.repository.files!, "download").mockRejectedValue(
      new Error("Read unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download notes.txt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Read unavailable",
    );
    await act(async () => release());
    expect(screen.getByRole("alert")).toHaveTextContent("Read unavailable");
  });

  it("leaves upload failures visible without adding a row", async () => {
    const setup = await fixture();
    vi.spyOn(setup.repository.files!, "upload").mockRejectedValue(
      new Error("Upload unavailable"),
    );
    render(<TaskAttachments {...setup} store={setup.repository.files!} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    fireEvent.change(screen.getByLabelText("Attach file"), {
      target: { files: [new File(["text"], "notes.txt")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload unavailable",
    );
    expect(screen.queryByText("notes.txt")).toBeNull();
  });
});
