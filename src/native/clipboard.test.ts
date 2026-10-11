import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClipboard } from "./clipboard";

describe("writeClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await writeClipboard("TaskNotes/Tasks/a.md");
    expect(writeText).toHaveBeenCalledWith("TaskNotes/Tasks/a.md");
  });

  it("falls back to a selection copy and restores focus", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    await writeClipboard("[[a]]");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("reports failure when no copy path works", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    await expect(writeClipboard("x")).rejects.toThrow(
      "Clipboard access is not available.",
    );
  });
});
