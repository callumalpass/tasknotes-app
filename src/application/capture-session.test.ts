import { describe, expect, it, vi } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";
import { CaptureSession, captureSessionFor } from "./capture-session";
import { OperationalError } from "./operational-error";
import type { TaskRepository } from "./ports/task-repository";
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
    expect(session.getSnapshot().error?.detail).toContain("Disconnected");
    expect(session.getSnapshot().result?.input.due).toBe("2026-09-10");
    expect(session.discard()).toBe(true);
  });
  it("retains submission identity and input on retry, but not for an edited or accepted draft", async () => {
    const session = new CaptureSession();
    const create = vi
      .fn(async () => created)
      .mockRejectedValueOnce(new Error("Unknown outcome"));
    const options = { configuration, defaults: {}, create };
    session.editText("First");
    await session.submit(options);
    await session.submit(options);
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    session.editText("First");
    await session.submit(options);
    expect(create.mock.calls[2]).not.toEqual(create.mock.calls[0]);
    create.mockRejectedValueOnce(new Error("Rejected"));
    session.editText("Before edit");
    await session.submit(options);
    session.editText("After edit");
    await session.submit(options);
    expect(create.mock.calls[4]).not.toEqual(create.mock.calls[3]);
  });

  it("pins unknown acceptance to recovery and retains that guard after a missing receipt", async () => {
    const session = new CaptureSession();
    const create = vi
      .fn<TaskRepository["create"]>(async () => created)
      .mockImplementationOnce(async (_input, intent) => {
        intent!.authorityRequestId = "exact-request";
        throw connectError("operation_outcome_unknown", "Unconfirmed", {
          operationOutcome: "unknown",
          details: { request_id: "exact-request" },
        });
      })
      .mockRejectedValueOnce(new Error("Receipt missing"));
    const options = { configuration, defaults: {}, create };
    session.editText("First");
    await session.submit(options);
    expect(session.canRecover).toBe(true);
    session.editText("Different");
    session.editFields({ priority: "high" }, configuration);
    expect(session.getSnapshot().text).toBe("First");
    expect(session.discard()).toBe(false);
    await session.submit(options);
    expect(session.getSnapshot().error?.code).toBe("outcome-unknown");
    await session.submit(options);
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[2]);
    expect(session.canRecover).toBe(false);
    expect(session.getSnapshot().text).toBe("");
  });

  it("keeps the unknown-outcome guard when no exact receipt identity is available", async () => {
    const session = new CaptureSession();
    const create = vi.fn(async () => {
      throw new OperationalError(
        "outcome-unknown",
        "create-task",
        false,
        "Unconfirmed",
      );
    });
    const options = { configuration, defaults: {}, create };
    session.editText("First");
    await session.submit(options);
    expect(session.canRecover).toBe(false);
    expect(await session.submit(options)).toBeNull();
    expect(create).toHaveBeenCalledOnce();
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
