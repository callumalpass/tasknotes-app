// @vitest-environment node
import {
  connect,
  toValue,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import type {
  ModelSetupIntent,
  ModelSetupScope,
} from "../application/ports/model-setup";
import { NextInstallationWorker } from "./next-installation-worker";
import type {
  NextInstallationBuildInput,
  NextInstallationRequest,
  NextInstallationResponse,
  NextInstallationResult,
} from "./next-installation-protocol";

vi.mock("@mdbase-dev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mdbase-dev/sdk")>()),
  connect: vi.fn(),
}));
const scope: ModelSetupScope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
const build = {
  environment: "lab",
  appOrigin: "http://127.0.0.1:48319",
  release: {},
  runtime: new Uint8Array([0]),
  runtimeSha256: "0".repeat(64),
} as NextInstallationBuildInput;
class PublicDataPort {
  onmessage = null;
  onmessageerror = null;
  start() {}
  postMessage() {}
  close() {}
}
class ControlWorker {
  static last: ControlWorker;
  static created = true;
  static initial: ModelSetupIntent | null = null;
  requests: NextInstallationRequest[] = [];
  intent = ControlWorker.initial;
  markerConfirmed = false;
  loseMarkerOnce = false;
  terminated = 0;
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  constructor() {
    ControlWorker.last = this;
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
  terminate() {
    this.terminated++;
  }
  postMessage(request: NextInstallationRequest) {
    this.requests.push(request);
    queueMicrotask(() => {
      const command = request.command;
      let result: NextInstallationResult = null;
      switch (command.kind) {
        case "open":
          result = {
            requestId: scope.account,
            installationId: scope.installation,
            deviceId: "44444444-4444-4444-8444-444444444444",
            appId: "tasknotes-web",
            kind: "app-runtime",
            verificationUri: "https://example.test/verify",
            state: "pending",
            accountId: null,
            collectionIds: [],
            createCollections: false,
            requestedCreateCollections: false,
          };
          break;
        case "open-collection":
          result = {
            kind: "collection",
            scope,
            displayName: "Synthetic collection",
            requiresTaskNotesModelSetup: ControlWorker.created,
            channel: new PublicDataPort() as unknown as MessagePort,
          };
          break;
        case "model-setup-intent":
          if (command.action === "prepare" && !this.intent)
            this.intent = {
              version: 1,
              scope,
              ops: command.ops,
              mutationId: crypto.randomUUID(),
              phase: "prepared",
            };
          if ("mutationId" in command && this.intent)
            this.intent = {
              ...this.intent,
              phase:
                command.action === "attempt"
                  ? "attempted"
                  : command.action === "confirm"
                    ? "confirmed"
                    : "verified",
            };
          result = this.intent ? structuredClone(this.intent) : null;
          break;
        case "model-setup-verified":
          if (this.loseMarkerOnce) {
            this.loseMarkerOnce = false;
            this.reply({
              version: 1,
              id: request.id,
              ok: false,
              reason: "outcome_unknown",
            });
            return;
          }
          this.markerConfirmed = true;
          break;
      }
      this.reply({ version: 1, id: request.id, ok: true, result });
    });
  }
  reply(response: NextInstallationResponse) {
    for (const fn of this.listeners.get("message") ?? [])
      fn({ data: response } as MessageEvent);
  }
}
const clients: MdbaseClient[] = [];
const owners: NextInstallationWorker[] = [];
beforeEach(() => {
  ControlWorker.created = true;
  ControlWorker.initial = null;
  vi.stubGlobal("Worker", ControlWorker);
  vi.stubGlobal("MessagePort", PublicDataPort);
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "hidden" }),
  );
  vi.mocked(connect).mockReset();
});
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.close().catch(() => {});
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture({
  created = true,
  permission = true,
  lifetime,
}: { created?: boolean; permission?: boolean; lifetime?: AbortSignal } = {}) {
  ControlWorker.created = created;
  const replica = new MemoryReplica({
    collection: scope.collection,
    capabilities: permission
      ? ["read", "write", "definitions.manage"]
      : ["read", "write"],
  });
  const sdk =
    await vi.importActual<typeof import("@mdbase-dev/sdk")>("@mdbase-dev/sdk");
  const client = await sdk.connect({
    connector: replica.connector(),
    app: { name: "TaskNotes model wiring test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const implementations = generated.type.implements as Array<{
    contract: string;
    version: string;
    fields: Record<string, string>;
    binding: Record<string, unknown>;
  }>;
  const implementation = implementations.find(
    (value) => value.contract === "tasknotes.task",
  )!;
  vi.spyOn(client, "describe").mockImplementation(async (signal) => {
    const listed = await client.resources.list({ text: true, signal });
    const contract = listed.resources.some(
      (value) => value.path === generated.paths.contract,
    );
    const type = listed.resources.some(
      (value) => value.path === generated.paths.type,
    );
    const catalog: wire.DescribeResult = {
      specVersion: "0.3.0",
      inclusion: { include: [] },
      issues: [],
      settings: new Map(),
      contracts: contract
        ? [
            {
              id: "tasknotes.task",
              version: "0.3.0-rc.5",
              digest: TASKNOTES_CONTRACT_DIGEST,
              path: generated.paths.contract,
              contractType: "record",
              implementedBy: type ? ["task"] : [],
            },
          ]
        : [],
      types: type
        ? [
            {
              name: "task",
              path: generated.paths.type,
              implements: [
                {
                  contract: implementation.contract,
                  version: implementation.version,
                  fields: new Map(Object.entries(implementation.fields)),
                  binding: toValue(implementation.binding as never),
                },
              ],
            },
          ]
        : [],
    };
    return catalog;
  });
  vi.mocked(connect).mockResolvedValueOnce(client);
  const { worker: owner } = await NextInstallationWorker.open(
    build,
    "existing",
    undefined,
    lifetime,
  );
  owners.push(owner);
  return { owner, worker: ControlWorker.last, client, replica, generated };
}
// One real SDK MemoryReplica client; control/port/catalog stand-ins, not native
// receipt/READ/LAB qualification. No second client or production host is opened.
describe("original Worker model journal and held repository wiring", () => {
  it("fresh creation installs exactly two definitions on the original client and awaits the creator finalizer", async () => {
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
    expect(vi.mocked(connect).mock.calls[0]![0]).toMatchObject({
      reconnect: false,
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0]).toHaveLength(2);
    expect(submit.mock.calls[0]![1]).not.toHaveProperty("allowPartial");
    expect(f.worker.intent).toMatchObject({
      phase: "verified",
      scope,
      mutationId: submit.mock.calls[0]![1]!.mutationId,
    });
    expect(f.worker.markerConfirmed).toBe(true);
    expect(await repository.modelSetup!.inspect()).toEqual({ state: "ready" });
    expect(f.owner.modelSetupJournal().scope).toEqual(scope);
    await expect(f.owner.openCollection(scope.collection)).rejects.toThrow(
      "already opened",
    );
    expect(
      f.worker.requests.filter(
        (value) => value.command.kind === "open-collection",
      ),
    ).toHaveLength(1);
  });
  it("an existing empty collection remains explicit setup, with no automatic writes", async () => {
    const f = await fixture({ created: false });
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    expect(submit).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(false);
    expect(await repository.modelSetup!.inspect()).toEqual({
      state: "required",
    });
    await repository.modelSetup!.install();
    expect(submit).toHaveBeenCalledOnce();
    expect(f.worker.markerConfirmed).toBe(true);
  });
  it("a created target without definitions permission retains the same held repository for grant UI", async () => {
    const f = await fixture({ permission: false });
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    expect(await repository.modelSetup!.inspect()).toMatchObject({
      state: "permission_required",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(false);
    expect(f.worker.terminated).toBe(0);
  });
  it("a lost model submit reply resumes the same UUID/receipt through the held repository without resubmitting", async () => {
    const f = await fixture();
    const original = f.client.submit.bind(f.client);
    const submit = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        const writes = await original(...args);
        await writes[0]!.confirmed;
        throw new Error("Synthetic lost reply");
      });
    const repository = await f.owner.openCollection(scope.collection);
    const id = f.worker.intent!.mutationId;
    expect(await repository.modelSetup!.inspect()).toMatchObject({
      state: "outcome_unknown",
    });
    const receipt = vi.spyOn(f.client, "awaitReceipt");
    await repository.modelSetup!.resume();
    expect(receipt).toHaveBeenCalledWith(
      id,
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(f.worker.intent).toMatchObject({
      mutationId: id,
      phase: "verified",
    });
    expect(f.worker.markerConfirmed).toBe(true);
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
  });
  it("a lost creator completion reply retains the original verified intent and finishes without another model write", async () => {
    const f = await fixture();
    f.worker.loseMarkerOnce = true;
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    const id = f.worker.intent!.mutationId;
    expect(f.worker.markerConfirmed).toBe(false);
    expect(f.worker.intent!.phase).toBe("verified");
    await repository.modelSetup!.resume();
    expect(f.worker.markerConfirmed).toBe(true);
    expect(f.worker.intent!.mutationId).toBe(id);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      f.worker.requests.filter(
        (value) => value.command.kind === "model-setup-verified",
      ),
    ).toHaveLength(2);
  });
  it("already-valid definitions finalize the original creator with no invented model mutation", async () => {
    const f = await fixture();
    f.replica.seedResource(
      f.generated.paths.contract,
      f.generated.contractDocument,
    );
    f.replica.seedResource(f.generated.paths.type, f.generated.typeDocument);
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    expect(await repository.modelSetup!.inspect()).toEqual({ state: "ready" });
    expect(submit).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(true);
  });
  it("abort during model setup cannot publish a disposed repository or reattach foreground listeners", async () => {
    const lifetime = new AbortController();
    const f = await fixture({ lifetime: lifetime.signal });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
    const original = f.client.submit.bind(f.client);
    vi.spyOn(f.client, "submit").mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return original(...args);
    });
    const publish = f.owner.openCollection(scope.collection);
    await arrived;
    lifetime.abort();
    await f.owner.close();
    const attached = vi.spyOn(document, "addEventListener");
    release();
    await expect(publish).rejects.toThrow();
    expect(attached).not.toHaveBeenCalled();
    expect(f.worker.markerConfirmed).toBe(false);
    expect(f.worker.intent!.phase).toBe("attempted");
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
    expect(f.worker.terminated).toBe(1);
  });
});
