import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextInstallationWorker } from "./next-installation-worker";
import type {
  NextInstallationBuildInput,
  NextInstallationRequest,
  NextInstallationResponse,
} from "./next-installation-protocol";
import { TASKNOTES_APPLICATION_REGISTRATION } from "./next-application-registration";
const build = {
  ...TASKNOTES_APPLICATION_REGISTRATION,
  environment: "lab",
  appOrigin: "http://127.0.0.1:48218",
  release: {},
  runtime: new Uint8Array([0]),
  runtimeSha256: "0".repeat(64),
} as NextInstallationBuildInput;
const view = { state: "pending" } as never;
class FakeWorker {
  static last: FakeWorker;
  requests: NextInstallationRequest[] = [];
  terminated = 0;
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  constructor() {
    FakeWorker.last = this;
  }
  addEventListener(kind: string, fn: (event: MessageEvent) => void) {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(fn);
  }
  removeEventListener(kind: string, fn: (event: MessageEvent) => void) {
    this.listeners.get(kind)?.delete(fn);
  }
  postMessage(request: NextInstallationRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated++;
  }
  reply(response: NextInstallationResponse) {
    for (const listener of this.listeners.get("message") ?? [])
      listener({ data: response } as MessageEvent);
  }
  ok(result: unknown = view) {
    const request = this.requests.at(-1)!;
    this.reply({
      version: 1,
      id: request.id,
      ok: true,
      result: result as never,
    });
  }
}
async function opened() {
  const pending = NextInstallationWorker.open(build, "existing");
  FakeWorker.last.ok();
  return (await pending).worker;
}
describe("installation Worker transport (source mocks, not LAB/native qualification)", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("a pre-aborted UI lifetime cannot create a Worker or protected slot", async () => {
    const previous = FakeWorker.last,
      lifetime = new AbortController();
    lifetime.abort();
    await expect(
      NextInstallationWorker.open(
        build,
        "existing",
        undefined,
        lifetime.signal,
      ),
    ).rejects.toThrow();
    expect(FakeWorker.last).toBe(previous);
  });
  it("aborting pending acquisition fail-stops before any device/HTTP operation and late results cannot reopen", async () => {
    const lifetime = new AbortController();
    const pending = NextInstallationWorker.open(
      build,
      "existing",
      undefined,
      lifetime.signal,
    );
    const rejected = expect(pending).rejects.toThrow("Worker stopped");
    const worker = FakeWorker.last;
    lifetime.abort();
    await rejected;
    worker.ok();
    expect(worker.terminated).toBe(1);
    expect(worker.requests.map((request) => request.command.kind)).toEqual([
      "open",
    ]);
  });
  it("only opens original explicit mode; does not automatically START/attest/retry", async () => {
    const client = await opened();
    const worker = FakeWorker.last;
    expect(worker.requests.map((request) => request.command.kind)).toEqual([
      "open",
    ]);
    expect(worker.requests[0]!.command).toMatchObject({
      mode: "existing",
      build: { ...TASKNOTES_APPLICATION_REGISTRATION },
    });
    const started = client.start();
    await expect(client.exchange()).rejects.toThrow("busy");
    worker.ok();
    await started;
    const closing = client.close();
    await vi.waitFor(() =>
      expect(worker.requests.at(-1)?.command.kind).toBe("close"),
    );
    worker.ok(null);
    await closing;
    expect(worker.requests.map((request) => request.command.kind)).toEqual([
      "open",
      "start",
      "close",
    ]);
    expect(worker.terminated).toBe(1);
  });
  it("explicit renewal is a fixed command; unknown outcomes never automatically renew again", async () => {
    const client = await opened(),
      worker = FakeWorker.last;
    const renewal = client.renewExpiredPairing();
    const refused = expect(renewal).rejects.toThrow("outcome_unknown");
    expect(worker.requests.at(-1)?.command).toEqual({ kind: "renew-expired" });
    worker.reply({
      version: 1,
      id: worker.requests.at(-1)!.id,
      ok: false,
      reason: "outcome_unknown",
    });
    await refused;
    expect(worker.terminated).toBe(0);
    const resume = client.start();
    worker.ok();
    await resume;
    expect(worker.requests.map((request) => request.command.kind)).toEqual([
      "open",
      "renew-expired",
      "start",
    ]);
    const closing = client.close();
    await vi.waitFor(() =>
      expect(worker.requests.at(-1)?.command.kind).toBe("close"),
    );
    worker.ok(null);
    await closing;
  });
  it("close drains the original in-flight operation before shutdown and rejects new commands", async () => {
    const client = await opened();
    const worker = FakeWorker.last;
    const start = client.start();
    const closing = client.close();
    await expect(client.attest()).rejects.toThrow("closed");
    expect(worker.requests.at(-1)?.command.kind).toBe("start");
    worker.ok();
    await start;
    await vi.waitFor(() =>
      expect(worker.requests.at(-1)?.command.kind).toBe("close"),
    );
    expect(worker.terminated).toBe(0);
    worker.ok(null);
    await closing;
    expect(worker.terminated).toBe(1);
  });
  it("native shutdown failure fail-stops the owned Worker, with no replacement actor", async () => {
    const client = await opened();
    const worker = FakeWorker.last;
    const closing = client.close();
    const rejected = expect(closing).rejects.toThrow("unavailable");
    await vi.waitFor(() =>
      expect(worker.requests.at(-1)?.command.kind).toBe("close"),
    );
    worker.reply({
      version: 1,
      id: worker.requests.at(-1)!.id,
      ok: false,
      reason: "unavailable",
    });
    await rejected;
    expect(worker.terminated).toBe(1);
    await expect(client.start()).rejects.toThrow("closed");
    expect(FakeWorker.last).toBe(worker);
  });
  it("foreign/stale responses fail-stop, not a receipt or automatic retry", async () => {
    const client = await opened();
    const worker = FakeWorker.last;
    const pending = client.exchange();
    const rejected = expect(pending).rejects.toThrow("Worker stopped");
    worker.reply({ version: 1, id: 1, ok: true, result: view });
    await rejected;
    expect(worker.terminated).toBe(1);
    await client.close();
  });
  it("does not publish arbitrary error text or lower-case credential-shaped values", async () => {
    const client = await opened();
    const worker = FakeWorker.last;
    const pending = client.start();
    const rejected = expect(pending).rejects.toThrow("unavailable");
    worker.reply({
      version: 1,
      id: worker.requests.at(-1)!.id,
      ok: false,
      reason: "opaqueprivatevalue",
    });
    await rejected;
    expect(worker.terminated).toBe(1);
    await client.close();
  });
  it("unknown outcome timeout fail-stops without automatic replacement or retry", async () => {
    vi.useFakeTimers();
    const client = await opened();
    const worker = FakeWorker.last;
    const pending = client.start();
    const rejected = expect(pending).rejects.toThrow("outcome unknown");
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(worker.terminated).toBe(1);
    expect(worker.requests.map((request) => request.command.kind)).toEqual([
      "open",
      "start",
    ]);
    await client.close();
  });
});
