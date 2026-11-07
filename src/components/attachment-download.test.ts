import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoFileStore } from "../demo/demo-file-store";
import { downloadAttachment } from "./attachment-download";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("attachment downloads", () => {
  it.each(["html", "svg", "txt", "pdf"])(
    "downloads %s as inert bytes with the filename instead of navigating",
    async (extension) => {
      vi.useFakeTimers();
      const createObjectURL = vi.fn<(blob: Blob) => string>(
        () => "blob:download-only",
      );
      const revokeObjectURL = vi.fn();
      vi.stubGlobal(
        "URL",
        class extends URL {
          static createObjectURL = createObjectURL;
          static revokeObjectURL = revokeObjectURL;
        },
      );
      const open = vi.spyOn(window, "open");
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.download).toBe(`file.${extension}`);
          expect(this.href).toBe("blob:download-only");
          expect(this.isConnected).toBe(true);
        });
      const store = new DemoFileStore();
      const file = await store.upload(
        `Attachments/file.${extension}`,
        new Blob(["<script>bad()</script>"], { type: "text/html" }),
      );

      await downloadAttachment(store, file, `file.${extension}`);

      expect(click).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("application/octet-stream");
      expect(await blob.text()).toBe("<script>bad()</script>");
      expect(document.querySelector("a[download]")).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:download-only");
    },
  );

  it("propagates read failure without creating a download", async () => {
    const store = new DemoFileStore();
    const file = await store.upload("Attachments/empty", new Blob([]));
    await store.delete(file);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await expect(downloadAttachment(store, file, "empty")).rejects.toThrow(
      "File not found",
    );
    expect(click).not.toHaveBeenCalled();
  });
});
