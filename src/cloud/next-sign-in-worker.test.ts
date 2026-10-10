import { NextInstallationWorker } from "./next-installation-worker";
import type {
  AppBundledReleaseTrust,
  AppWebSignInSnapshot,
} from "@mdbase-dev/sdk/app-host";
import type {
  NextInstallationBuildInput,
  NextInstallationRequest,
} from "./next-installation-protocol";

// Real app transport/portal owner, fake Worker/SDK snapshots. These checks do
// not authenticate a real account or qualify native SQL/storage/durability.
const id = "11111111-1111-4111-8111-111111111111";
const collection = "22222222-2222-4222-8222-222222222222";
const cpOrigin = "https://connect-lab.mdbase.dev";
const release: AppBundledReleaseTrust = {
  schema: "mdbn-app-trust/release/1",
  environment: "lab",
  cpOrigin,
  logOrigin: "https://log.example.test",
  assetSha256: "11".repeat(32),
  trustedRoots: [new Uint8Array(32).fill(1)],
  policyPins: Uint8Array.of(1),
  source: {
    repository: "mdbase-dev/mdbase-connect",
    commit: "22".repeat(20),
    version: "unit-only",
  },
};
const build: NextInstallationBuildInput = {
  environment: "lab",
  appOrigin: "http://127.0.0.1:48218",
  release,
  appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
  appName: "TaskNotes",
  runtime: Uint8Array.of(1),
  runtimeSha256: "11".repeat(32),
};
function snapshot(
  status: AppWebSignInSnapshot["status"] = "signed_out",
  paired = false,
): AppWebSignInSnapshot {
  return {
    status,
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
    signIn: {
      requestId: id,
      installationId: id,
      deviceId: id,
      appId: build.appId,
      kind: "app-runtime",
      verificationUri: `${cpOrigin}/pair/${id}`,
      state: paired ? "paired" : "pending",
      accountId: paired ? id : null,
      accountEmail: paired ? "person@example.test" : null,
      collectionIds: [],
      createCollections: false,
      requestedCreateCollections: true,
    },
  };
}
class FakeWorker {
  static latest: FakeWorker;
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly terminate = vi.fn();
  readonly sent: unknown[] = [];
  closeOk = true;
  pending: NextInstallationRequest | null = null;
  constructor() {
    FakeWorker.latest = this;
  }
  addEventListener(
    kind: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    if (kind === "message") this.listeners.add(listener);
  }
  removeEventListener(
    kind: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    if (kind === "message") this.listeners.delete(listener);
  }
  emit(data: unknown) {
    for (const listener of this.listeners)
      listener(new MessageEvent("message", { data }));
  }
  postMessage(value: NextInstallationRequest | { event: string }) {
    this.sent.push(value);
    if ("event" in value) {
      queueMicrotask(() =>
        this.emit({ version: 1, event: "session-closed", ok: this.closeOk }),
      );
      return;
    }
    if (value.command.kind === "session-open")
      this.reply(value, snapshot("not_started"));
    else this.pending = value;
  }
  reply(request: NextInstallationRequest, value: AppWebSignInSnapshot) {
    this.emit({
      version: 1,
      id: request.id,
      ok: true,
      result: { kind: "session", snapshot: value },
    });
  }
  push(value: AppWebSignInSnapshot) {
    this.emit({ version: 1, event: "session-snapshot", snapshot: value });
  }
}
beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function fixture() {
  const owner = await NextInstallationWorker.openSession(build);
  const worker = FakeWorker.latest;
  const start = owner.startSession();
  worker.reply(worker.pending!, snapshot());
  await start;
  return { owner, worker };
}
it("public snapshot/portal pushes cannot settle an unrelated command reply", async () => {
  const { owner, worker } = await fixture();
  const portal = { navigate: vi.fn(), close: vi.fn() };
  owner.reservePortal(() => portal);
  const authorization = owner.authorizeSession(),
    complete = vi.fn();
  void authorization.then(complete);
  worker.push(snapshot("authorizing"));
  worker.emit({
    version: 1,
    event: "portal-navigate",
    uri: `${cpOrigin}/pair/${id}`,
  });
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  expect(owner.getSnapshot()?.status).toBe("authorizing");
  expect(portal.navigate).toHaveBeenCalledOnce();
  worker.reply(worker.pending!, snapshot("authorizing"));
  await authorization;
  expect(complete).toHaveBeenCalledOnce();
  await owner.close();
});
it("closes the owned popup only after genuine approval, not an already-paired additional-consent wait", async () => {
  const { owner, worker } = await fixture(),
    portal = { navigate: vi.fn(), close: vi.fn() };
  owner.reservePortal(() => portal);
  worker.push(snapshot("authorizing", true));
  expect(portal.close).not.toHaveBeenCalled();
  worker.push(snapshot("unselected", true));
  expect(portal.close).toHaveBeenCalledOnce();
  worker.push(snapshot("unselected", true));
  await owner.close();
  expect(portal.close).toHaveBeenCalledOnce();
});
it("rejects a foreign-origin portal push and closes the original owner rather than navigating", async () => {
  const { owner, worker } = await fixture(),
    portal = { navigate: vi.fn(), close: vi.fn() };
  owner.reservePortal(() => portal);
  worker.emit({
    version: 1,
    event: "portal-navigate",
    uri: "https://other.example.test/pair/original",
  });
  await owner.close();
  expect(portal.navigate).not.toHaveBeenCalled();
  expect(portal.close).toHaveBeenCalledOnce();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("does not apply the legacy 30-second fail-stop to the SDK's original request", async () => {
  vi.useFakeTimers();
  const { owner, worker } = await fixture();
  const authorization = owner.authorizeSession();
  await vi.advanceTimersByTimeAsync(31_000);
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply(worker.pending!, snapshot("authorizing"));
  await authorization;
  const closing = owner.close();
  await vi.runAllTimersAsync();
  await closing;
});
it("failed SDK shutdown retains the original Worker, without pretending native/SQL/lease stop succeeded", async () => {
  const { owner, worker } = await fixture();
  worker.closeOk = false;
  await expect(owner.close()).rejects.toThrow(
    "shutdown could not be confirmed",
  );
  expect(worker.terminate).not.toHaveBeenCalled();
  await expect(owner.startSession()).rejects.toThrow("closed");
});
it("rejects a forged snapshot's custody field without replacing the original owner", async () => {
  const { owner, worker } = await fixture();
  worker.closeOk = false;
  worker.emit({
    version: 1,
    event: "session-snapshot",
    snapshot: { ...snapshot(), host: { secret: "stand-in" } },
  });
  await expect(owner.close()).rejects.toThrow();
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(owner.getSnapshot()?.status).toBe("signed_out");
});
it("a late response after close begins cannot publish a new ready snapshot", async () => {
  const { owner, worker } = await fixture();
  const authorization = owner.authorizeSession();
  const rejection = expect(authorization).rejects.toThrow("closed");
  const closing = owner.close();
  worker.reply(worker.pending!, {
    ...snapshot("ready", true),
    selectedCollectionId: collection,
  });
  await rejection;
  await closing;
  expect(owner.getSnapshot()?.status).not.toBe("ready");
});
