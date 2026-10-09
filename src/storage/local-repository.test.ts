import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextTaskRepository } from "./next-repository";
import {
  openLocalTaskRepository,
  type TaskNotesLocalHost,
  type LocalTaskRepository,
} from "./local-repository";

const repositories: LocalTaskRepository[] = [];
afterEach(async () => {
  for (const repository of repositories.splice(0))
    await repository.whenDisposed().catch(() => {});
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const replica = new MemoryReplica();
  const scope = {
    account: crypto.randomUUID(),
    installation: crypto.randomUUID(),
    collection: replica.collection,
  };
  const connector = replica.connector();
  const open = vi.spyOn(connector, "open");
  const close = vi.fn(async () => {});
  const host: TaskNotesLocalHost = {
    scope,
    connector,
    close,
    isCurrent: () => true,
    waitForVerifiedRead: vi.fn(async () => {}),
  };
  return { host, scope, open, close };
}

describe("dormant own-local-host repository lifecycle (SDK stand-in, NOT native bootstrap/LAB)", () => {
  it("waits for the explicit native read gate before any data connection", async () => {
    const f = fixture(),
      gate = deferred();
    f.host.waitForVerifiedRead = () => gate.promise;
    const opening = openLocalTaskRepository(f.host, "Local tasks");
    expect(f.open).not.toHaveBeenCalled();
    gate.resolve();
    const repository = await opening;
    repositories.push(repository);
    expect(repository).toBeInstanceOf(NextTaskRepository);
    expect((await repository.collectionInfo()).id).toBe(
      `next:${f.scope.account}:${f.scope.collection}`,
    );
    expect(f.open).toHaveBeenCalledOnce();
  });
  it("immediate disposal closes data synchronously before asynchronous host stop", async () => {
    const f = fixture(),
      stopped = deferred();
    f.close.mockImplementation(() => stopped.promise);
    const repository = await openLocalTaskRepository(f.host, "Local tasks");
    repositories.push(repository);
    repository.dispose();
    repository.dispose();
    await expect(repository.get("fixture")).rejects.toThrow("disposed");
    let done = false;
    const closing = repository.whenDisposed().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(f.close).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    stopped.resolve();
    await closing;
    expect(done).toBe(true);
  });
  it("aborts a waiting read gate without constructing a repository or retrying later", async () => {
    const f = fixture(),
      gate = deferred(),
      abort = new AbortController();
    f.host.waitForVerifiedRead = () => gate.promise;
    const opening = openLocalTaskRepository(f.host, "Local tasks", {
      signal: abort.signal,
    });
    abort.abort("private fixture detail");
    await expect(opening).rejects.toMatchObject({ reason: "aborted" });
    gate.resolve();
    await Promise.resolve();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("an already aborted opening closes its transferred host without data access", async () => {
    const f = fixture();
    await expect(
      openLocalTaskRepository(f.host, "Local tasks", {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(f.host.waitForVerifiedRead).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("rejects scope changes during the native gate and never falls back", async () => {
    const f = fixture(),
      gate = deferred();
    f.host.waitForVerifiedRead = () => gate.promise;
    const opening = openLocalTaskRepository(f.host, "Local tasks");
    f.scope.account = crypto.randomUUID();
    gate.resolve();
    await expect(opening).rejects.toMatchObject({ reason: "binding" });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("checks the actual SDK Hello collection, not a caller metadata claim", async () => {
    const f = fixture();
    f.scope.collection = crypto.randomUUID();
    await expect(
      openLocalTaskRepository(f.host, "Local tasks"),
    ).rejects.toMatchObject({ reason: "binding" });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("failed native readiness remains an opening error, without leaked details", async () => {
    const f = fixture();
    f.host.waitForVerifiedRead = async () => {
      throw Error("private fixture root detail");
    };
    await expect(
      openLocalTaskRepository(f.host, "Local tasks"),
    ).rejects.toMatchObject({
      reason: "unavailable",
      message:
        "Local collection opening failed: unavailable. Preserve its storage and reopen.",
    });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("failed termination is observable through whenDisposed without resetting/retrying", async () => {
    const f = fixture();
    f.close.mockRejectedValue(Error("private termination fixture"));
    const repository = await openLocalTaskRepository(f.host, "Local tasks");
    repositories.push(repository);
    repository.dispose();
    await expect(repository.whenDisposed()).rejects.toMatchObject({
      reason: "shutdown_failed",
      message:
        "Local collection opening failed: shutdown_failed. Preserve its storage and reopen.",
    });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("abort cleanup failure is explicit and does not expose the host exception", async () => {
    const f = fixture();
    f.close.mockRejectedValue(Error("private termination fixture"));
    await expect(
      openLocalTaskRepository(f.host, "Local tasks", {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ reason: "shutdown_failed" });
    expect(f.close).toHaveBeenCalledOnce();
  });
});
