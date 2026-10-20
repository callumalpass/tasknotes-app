import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import type {
  NextInstallationBuildInput,
  NextInstallationRequest,
} from "./next-installation-protocol";
import type { NextTaskRepository } from "../storage/next-repository";
import { NextInstallationWorker } from "./next-installation-worker";
type Options = NonNullable<ConstructorParameters<typeof NextTaskRepository>[3]>;
const f = vi.hoisted(() => ({
  options: undefined as Options | undefined,
  connect: vi.fn(async () => ({ close: vi.fn() })),
}));
vi.mock("@mdbase-dev/sdk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connect: f.connect,
}));
vi.mock("../storage/next-repository", () => ({
  NextTaskRepository: class {
    constructor(
      _client: unknown,
      _name: string,
      _account: string,
      options: Options,
    ) {
      f.options = options;
    }
    dispose() {}
  },
}));
// Original app transport and callback, with explicit Worker/client/repository
// stand-ins. No native semantic readiness or factory acceptance claim.
const id = "11111111-1111-4111-8111-111111111111";
const collection = "22222222-2222-4222-8222-222222222222";
const build: NextInstallationBuildInput = {
  environment: "lab",
  appOrigin: "http://127.0.0.1:48218",
  appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
  appName: "TaskNotes",
  runtime: Uint8Array.of(1),
  runtimeSha256: "11".repeat(32),
  release: {
    schema: "mdbn-app-trust/release/1",
    environment: "lab",
    cpOrigin: "https://connect-lab.mdbase.dev",
    logOrigin: "https://log.example.test",
    assetSha256: "11".repeat(32),
    trustedRoots: [new Uint8Array(32).fill(1)],
    policyPins: Uint8Array.of(1),
    source: {
      repository: "mdbase-dev/mdbase-connect",
      commit: "22".repeat(20),
      version: "unit-only",
    },
  },
};
function snapshot(selected = collection): AppWebSignInSnapshot {
  return {
    status: "setup_required",
    collections: [],
    selectedCollectionId: selected,
    problem: null,
    timing: null,
    signIn: {
      requestId: id,
      installationId: id,
      deviceId: id,
      appId: build.appId,
      kind: "app-runtime",
      verificationUri: `${build.release.cpOrigin}/pair/${id}`,
      state: "paired",
      accountId: id,
      collectionIds: [selected],
      createCollections: false,
      requestedCreateCollections: true,
    },
  };
}
class WorkerStandIn {
  static latest: WorkerStandIn;
  listeners = new Set<(event: MessageEvent) => void>();
  sent: NextInstallationRequest[] = [];
  pending: NextInstallationRequest | null = null;
  channel = new MessageChannel();
  constructor() {
    WorkerStandIn.latest = this;
  }
  addEventListener(kind: string, listener: (event: MessageEvent) => void) {
    if (kind === "message") this.listeners.add(listener);
  }
  removeEventListener(_kind: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }
  terminate() {}
  emit(data: unknown) {
    this.listeners.forEach((listener) =>
      listener(new MessageEvent("message", { data })),
    );
  }
  reply(request: NextInstallationRequest, result: unknown = null) {
    this.emit({ version: 1, id: request.id, ok: true, result });
  }
  postMessage(request: NextInstallationRequest | { event: string }) {
    if ("event" in request) {
      queueMicrotask(() =>
        this.emit({ version: 1, event: "session-closed", ok: true }),
      );
      return;
    }
    this.sent.push(request);
    if (request.command.kind === "session-open")
      this.reply(request, { kind: "session", snapshot: snapshot() });
    else if (request.command.kind === "session-connection")
      this.reply(request, {
        kind: "collection",
        scope: { account: id, installation: id, collection },
        displayName: "Original",
        requiresTaskNotesModelSetup: false,
        channel: this.channel.port2,
      });
    else if (request.command.kind === "set-foreground") this.reply(request);
    else this.pending = request;
  }
}
const closes: (() => Promise<void>)[] = [];
beforeEach(() => {
  f.options = undefined;
  vi.clearAllMocks();
  vi.stubGlobal("Worker", WorkerStandIn);
});
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  WorkerStandIn.latest.channel.port1.close();
  WorkerStandIn.latest.channel.port2.close();
  vi.unstubAllGlobals();
});
async function fixture() {
  const owner = await NextInstallationWorker.openSession(build);
  closes.push(() => owner.close());
  await owner.openCollection(collection);
  return {
    owner,
    worker: WorkerStandIn.latest,
    assess: f.options!.onModelSetupAssessment!,
  };
}
it("uses one original client and a bound fixed assessment, awaiting its exact reply", async () => {
  const { worker, assess } = await fixture();
  expect(f.connect).toHaveBeenCalledOnce();
  const signal = new AbortController().signal;
  const pending = assess("ready", signal);
  let delivered = false;
  void pending.then(() => {
    delivered = true;
  });
  await vi.waitFor(() =>
    expect(worker.pending?.command.kind).toBe("session-assess"),
  );
  expect(worker.pending!.command).toEqual({
    kind: "session-assess",
    collectionId: collection,
    state: "ready",
  });
  worker.emit({
    version: 1,
    event: "session-snapshot",
    snapshot: { ...snapshot(), status: "ready" },
  });
  await Promise.resolve();
  expect(delivered).toBe(false);
  worker.reply(worker.pending!);
  await pending;
  expect(delivered).toBe(true);
});
it("never sends an assessment for an already-cancelled caller", async () => {
  const { worker, assess } = await fixture();
  const caller = new AbortController();
  caller.abort();
  const count = worker.sent.length;
  await expect(assess("ready", caller.signal)).rejects.toThrow();
  expect(worker.sent).toHaveLength(count);
});
it("does not deliver success after the original caller aborts while its exact reply is pending", async () => {
  const { worker, assess } = await fixture();
  const caller = new AbortController();
  const pending = assess("ready", caller.signal);
  const failure = expect(pending).rejects.toThrow();
  await vi.waitFor(() =>
    expect(worker.pending?.command.kind).toBe("session-assess"),
  );
  caller.abort();
  worker.reply(worker.pending!);
  await failure;
  expect(
    worker.sent.filter((request) => request.command.kind === "session-assess"),
  ).toHaveLength(1);
});
it("refuses late readiness into a changed selection", async () => {
  const { worker, assess } = await fixture();
  worker.emit({
    version: 1,
    event: "session-snapshot",
    snapshot: snapshot(id),
  });
  const count = worker.sent.length;
  await expect(assess("ready", new AbortController().signal)).rejects.toThrow(
    "Original collection assessment unavailable",
  );
  expect(worker.sent).toHaveLength(count);
});
