import { describe, expect, it, vi } from "vitest";
import { CaptureSession, captureSessionFor } from "./capture-session";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { parseTaskCapture } from "../domain/task-capture";
import type { Task } from "../domain/task";
vi.mock("../domain/task-capture", async (load) => ({
  ...(await load<typeof import("../domain/task-capture")>()),
  parseTaskCapture: vi.fn(async (title: string) => ({
    input: { title },
    preview: [],
  })),
}));
const configuration = defaultTaskCollectionConfiguration();
const created = { id: "one", title: "First" } as Task;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("capture session lifetime", () => {
  it("keeps drafts and explicit edits independently of presentations", async () => {
    const repository = {};
    const session = captureSessionFor(repository, "view:today");
    session.editText("My draft");
    session.editFields(
      { due: "2026-09-10", body: "Important notes" },
      configuration,
    );
    await session.parse(configuration, {});
    expect(captureSessionFor(repository, "view:today")).toBe(session);
    expect(captureSessionFor({}, "view:today").getSnapshot().text).toBe("");
    expect(captureSessionFor(repository, "another").getSnapshot().text).toBe(
      "",
    );
    expect(session.getSnapshot().result?.input.body).toBe("Important notes");
  });
  it("deduplicates submission and preserves the entire failed draft", async () => {
    const session = new CaptureSession();
    const write = deferred<Task>();
    const create = vi.fn(() => write.promise);
    session.editText("My draft");
    session.editFields({ due: "2026-09-10" }, configuration);
    const options = { configuration, defaults: {}, create };
    const first = session.submit(options);
    expect(session.submit(options)).toBe(first);
    expect(session.discard()).toBe(false);
    session.editText("Cannot overwrite pending draft");
    expect(session.getSnapshot().text).toBe("My draft");
    write.reject(new Error("Disconnected"));
    await first;
    expect(create).toHaveBeenCalledOnce();
    expect(session.getSnapshot().error).toContain("Disconnected");
    expect(session.getSnapshot().result?.input.due).toBe("2026-09-10");
    expect(session.discard()).toBe(true);
  });
  it("never lets a delayed refresh clear or close a newer draft", async () => {
    const session = new CaptureSession();
    const refresh = deferred<void>();
    const accepted = vi.fn();
    session.editText("First");
    await session.submit({
      configuration,
      defaults: {},
      create: async () => created,
      refresh: () => refresh.promise,
      onAccepted: accepted,
    });
    const version = session.getSnapshot().version;
    expect(accepted).toHaveBeenCalledOnce();
    expect(session.canCloseAccepted(version)).toBe(true);
    session.editText("Second: keep me");
    refresh.reject(new Error("Refresh failed"));
    await vi.waitFor(() =>
      expect(session.getSnapshot().accepted?.followUp).toContain(
        "could not refresh",
      ),
    );
    expect(session.getSnapshot().text).toBe("Second: keep me");
    expect(session.getSnapshot().error).toBeNull();
    expect(session.canCloseAccepted(version)).toBe(false);
    expect(accepted).toHaveBeenCalledOnce();
  });
  it("retains accepted-write warnings instead of closing them away", async () => {
    const session = new CaptureSession();
    session.editText("First");
    await session.submit({
      configuration,
      defaults: {},
      create: async () => ({
        ...created,
        operationWarnings: ["Template unavailable"],
      }),
    });
    expect(session.canCloseAccepted(session.getSnapshot().version)).toBe(false);
  });
  it("rejects stale parser responses", async () => {
    const parse = deferred<Awaited<ReturnType<typeof parseTaskCapture>>>();
    vi.mocked(parseTaskCapture).mockReturnValueOnce(parse.promise);
    const session = new CaptureSession();
    session.editText("Old");
    const pending = session.parse(configuration, {});
    session.editText("New");
    parse.resolve({ input: { title: "Old" }, preview: [] });
    await pending;
    expect(session.getSnapshot().text).toBe("New");
    expect(session.getSnapshot().result).toBeNull();
  });
});
