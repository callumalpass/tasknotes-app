// @vitest-environment node
import {
  connect,
  toValue,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { init, loadCatalog } from "mdbase";
import { nativeResourceSetupAssessment } from "../storage/next-resource-plan";
import { taskNotesDefaultBaseSources } from "../domain/default-view-source";
import { resourceSetupPlan } from "../test/resource-setup-plan";
import publisher from "../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.18.json";
import { initializeModelPackCore } from "./next-model-pack-core";
import {
  nativeModelPackAssessment,
  nativeModelPackPlan,
} from "../storage/next-model-plan";

// Reuse the pinned package's Node-only filesystem WASM loader, as the planner
// fixtures do. Browser bounded/hash-verified delivery has separate tests; this
// fixture is not a native authorization, custody or READ witness.
vi.mock("./next-model-pack-core", () => ({
  initializeModelPackCore: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await init();
    signal.throwIfAborted();
  },
}));
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
  markerGate: Promise<void> | null = null;
  onMarkerEntered?: () => void;
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
              version: 2,
              scope,
              plan: command.plan,
              mutationId: crypto.randomUUID(),
              phase: "prepared",
            };
          if ("mutationId" in command && this.intent?.version === 2)
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
        case "model-resource-setup-intent":
          if (command.action === "prepare" && !this.intent)
            this.intent = {
              version: 3,
              scope,
              plan: command.plan,
              mutationId: crypto.randomUUID(),
              phase: "prepared",
            };
          if ("mutationId" in command && this.intent?.version === 3)
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
          this.onMarkerEntered?.();
          if (this.markerGate) {
            const gate = this.markerGate;
            this.markerGate = null;
            void gate.then(() => {
              this.markerConfirmed = true;
              this.reply({
                version: 1,
                id: request.id,
                ok: true,
                result: null,
              });
            });
            return;
          }
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
  await initializeModelPackCore(lifetime ?? new AbortController().signal);
  const replica = new MemoryReplica({
    collection: scope.collection,
    capabilities: permission
      ? [
          "read",
          "write",
          "collection.read",
          "definitions.manage",
          "records.create",
        ]
      : ["read", "write"],
  });
  replica.seedResource("mdbase.yaml", 'spec_version: "0.3.0"\n');
  const sdk =
    await vi.importActual<typeof import("@mdbase-dev/sdk")>("@mdbase-dev/sdk");
  const client = await sdk.connect({
    connector: replica.connector(),
    app: { name: "TaskNotes model wiring test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  // MemoryReplica is not a raw YAML/Base implementation. Explicit source/data
  // and discovery stand-ins exercise the real caller and SDK transport only.
  const sourceDocuments = new Map<string, string>();
  const originalSubmit = client.submit.bind(client);
  client.submit = async (ops, options) => {
    for (const op of ops)
      if (op.kind === "create" && typeof op.document === "string")
        sourceDocuments.set(op.id, op.document);
    return originalSubmit(ops, options);
  };
  const originalGet = client.get.bind(client);
  vi.spyOn(client, "get").mockImplementation(async (ref, include, signal) => {
    const record = await originalGet(ref, include, signal);
    if (!sourceDocuments.has(record.id)) return record;
    // Native classifies bare .base records from its resolved catalog; this
    // explicit protocol stand-in is needed because MemoryReplica does not.
    const catalog = await client.describe();
    const type = catalog.types.find((candidate) =>
      candidate.implements.some(
        (implementation) =>
          implementation.contract === "obsidian.base" &&
          implementation.version === "1.0.0",
      ),
    );
    if (!type) throw Error("Synthetic Base catalog is unavailable");
    return {
      ...record,
      types: [type.name],
      document: sourceDocuments.get(record.id)!,
    };
  });
  const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
  const views = async () =>
    Promise.all(
      [...sourceDocuments.keys()].sort().map(async (id) => {
        const record = await client.get(id);
        return {
          record: id,
          path: record.path,
          sourceRevision: record.revision,
          ordinal: 0,
          name: "Synthetic view",
          viewType: "tasknotesTaskList",
          implementations: [],
        };
      }),
    );
  vi.spyOn(client, "listAppBasesViews").mockImplementation(async () => ({
    kind: "success",
    views: await views(),
    continuation: null,
    clock,
    collectionRevision: "sha256:" + "ab".repeat(32),
  }));
  vi.spyOn(client, "readAppBasesViewSource").mockImplementation(
    async (selection) => ({
      kind: "success",
      view: (await views()).find((v) => v.record === selection.record)!,
      source: sourceDocuments.get(selection.record)!,
      clock,
      collectionRevision: "sha256:" + "ab".repeat(32),
    }),
  );
  vi.spyOn(client, "describe").mockImplementation(async (signal) => {
    const listed = await client.resources.list({ text: true, signal });
    const resources = Object.fromEntries(
      listed.resources.map((resource) => [resource.path, resource.text!]),
    );
    const core = await loadCatalog(resources);
    const catalog: wire.DescribeResult = {
      specVersion: "0.3.0",
      inclusion: { include: [] },
      issues: [],
      settings: new Map(),
      contracts: core.contracts.map((contract) => ({
        id: contract.id,
        version: contract.version,
        digest: contract.digest,
        path: contract.path,
        contractType: "record" as const,
        implementedBy: core.implementations
          .filter((implementation) => implementation.contract === contract.id)
          .map((implementation) => implementation.type),
      })),
      types: core.types.map((type) => ({
        name: type.name,
        path: type.path,
        implements: core.implementations
          .filter((implementation) => implementation.type === type.name)
          .map((implementation) => ({
            contract: implementation.contract,
            version: implementation.version,
            fields: new Map(implementation.fields),
            binding: toValue(implementation.binding as never),
          })),
      })),
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
  return { owner, worker: ControlWorker.last, client, replica };
}
// One real SDK MemoryReplica client; control/port/catalog stand-ins, not native
// receipt/READ/LAB qualification. No second client or production host is opened.
describe("original Worker model journal and held repository wiring", () => {
  it("opening a creator stays read-only until explicit setup submits and completes its original resource plan", async () => {
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    const uuid = vi.spyOn(crypto, "randomUUID");
    const repository = await f.owner.openCollection(scope.collection);
    expect(submit).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(false);
    await expect(
      repository.initialize({ deferTaskIndex: true }),
    ).rejects.toThrow("Complete this original collection");
    expect(await repository.modelSetup!.inspect()).toEqual({
      state: "required",
    });
    expect(uuid).not.toHaveBeenCalled();
    await repository.modelSetup!.install();
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
    expect(vi.mocked(connect).mock.calls[0]![0]).toMatchObject({
      reconnect: false,
    });
    expect(submit).toHaveBeenCalledOnce();
    const ops = submit.mock.calls[0]![0];
    const paths = ops.map((op) => ("path" in op ? op.path : undefined));
    for (const resource of publisher.manifest.resources)
      expect(paths.filter((path) => path === resource.target)).toHaveLength(1);
    expect(ops.filter((op) => op.kind === "create")).toHaveLength(5);
    expect(paths.filter((path) => path === "mdbase.lock.yaml")).toHaveLength(1);
    expect(submit.mock.calls[0]![1]).not.toHaveProperty("allowPartial");
    expect(f.worker.intent).toMatchObject({
      version: 3,
      phase: "verified",
      scope,
      mutationId: submit.mock.calls[0]![1]!.mutationId,
      plan: {
        packs: [
          expect.objectContaining({
            id: "tasknotes.task",
            version: "0.3.0-rc.18",
          }),
          expect.objectContaining({ id: "obsidian.base", version: "1.0.0" }),
        ],
        resourceOps: ops.filter((op) => op.kind !== "create"),
        sources: ops
          .filter((op) => op.kind === "create")
          .map((op) => ({ id: op.id, path: op.path, document: op.document })),
      },
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
    expect(submit).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    await expect(repository.modelSetup!.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
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
    expect(submit).not.toHaveBeenCalled();
    await expect(repository.modelSetup!.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const id = f.worker.intent!.mutationId;
    expect(f.worker.markerConfirmed).toBe(false);
    expect(f.worker.intent!.phase).toBe("verified");
    expect(await repository.modelSetup!.inspect()).toEqual({ state: "ready" });
    await expect(
      repository.initialize({ deferTaskIndex: true }),
    ).rejects.toThrow("Complete this original collection");
    await repository.modelSetup!.resume();
    await repository.initialize({ deferTaskIndex: true });
    expect(f.worker.markerConfirmed).toBe(true);
    expect(f.worker.intent!.mutationId).toBe(id);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      f.worker.requests.filter(
        (value) => value.command.kind === "model-setup-verified",
      ),
    ).toHaveLength(2);
  });
  it("a suspended and resumed scope cannot clear creator pending on an old finalizer reply", async () => {
    const f = await fixture();
    const repository = await f.owner.openCollection(scope.collection);
    let release!: () => void;
    f.worker.markerGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const markerEntered = new Promise<void>((resolve) => {
      f.worker.onMarkerEntered = resolve;
    });
    const submit = vi.spyOn(f.client, "submit");
    const install = repository.modelSetup!.install();
    const refused = expect(install).rejects.toThrow();
    await markerEntered;
    expect(
      f.worker.requests.filter(
        (request) => request.command.kind === "model-setup-verified",
      ),
    ).toHaveLength(1);
    const original = structuredClone(f.worker.intent!);
    expect(original.phase).toBe("verified");
    repository.suspend();
    repository.resume();
    release();
    await refused;
    expect(f.worker.markerConfirmed).toBe(true); // The old controller reply really succeeded.
    expect(f.worker.intent).toEqual(original);
    expect(await repository.modelSetup!.inspect()).toEqual({ state: "ready" });
    await expect(
      repository.initialize({ deferTaskIndex: true }),
    ).rejects.toThrow("Complete this original collection");
    await repository.modelSetup!.resume(); // Explicit same-intent completion on the NEW lifetime.
    await repository.initialize({ deferTaskIndex: true });
    expect(f.worker.intent).toEqual(original);
    expect(submit).toHaveBeenCalledOnce();
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
    expect(
      f.worker.requests.filter(
        (request) => request.command.kind === "model-setup-verified",
      ),
    ).toHaveLength(2);
  });
  it("already-current resource packs and exact native source discovery finalize without inventing another mutation", async () => {
    const f = await fixture();
    const resources = { "mdbase.yaml": 'spec_version: "0.3.0"\n' };
    const signal = new AbortController().signal;
    const plan = await nativeResourceSetupAssessment(
      resources,
      f.client,
      taskNotesDefaultBaseSources,
      signal,
    );
    for (const operation of plan.resourceOps) {
      if (operation.kind !== "resource_put")
        throw Error("Unexpected retirement on fresh install");
      f.replica.seedResource(operation.path, operation.doc);
    }
    const catalog = await loadCatalog(
      Object.fromEntries(
        plan.resourceReadback
          .filter((r) => r.doc !== null)
          .map((r) => [r.path, r.doc!]),
      ),
    );
    const baseType = catalog.implementations.find(
      (i) => i.contract === "obsidian.base",
    )!.type;
    await Promise.all(
      (
        await f.client.submit(
          plan.sources.map((source) => ({
            kind: "create" as const,
            id: crypto.randomUUID(),
            path: source.path,
            document: source.document,
            type: baseType,
          })),
          { mutationId: crypto.randomUUID() },
        )
      ).map((write) => write.confirmed),
    );
    const submit = vi.spyOn(f.client, "submit");
    submit.mockClear();
    const uuid = vi.spyOn(crypto, "randomUUID");
    const repository = await f.owner.openCollection(scope.collection);
    expect(await repository.modelSetup!.inspect()).toEqual({ state: "ready" });
    expect(submit).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(false);
    await expect(
      repository.initialize({ deferTaskIndex: true }),
    ).rejects.toThrow("Complete this original collection");
    await repository.modelSetup!.install();
    await repository.initialize({ deferTaskIndex: true });
    expect(submit).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.worker.intent).toBeNull();
    expect(f.worker.markerConfirmed).toBe(true);
  });
  it.each(["prepared", "attempted", "confirmed", "verified"] as const)(
    "recovers the original v2 %s plan without extending it to resource setup",
    async (phase) => {
      const f = await fixture();
      const signal = new AbortController().signal;
      const resources = { "mdbase.yaml": 'spec_version: "0.3.0"\n' };
      const assessment = await nativeModelPackAssessment(resources, signal);
      const plan = await nativeModelPackPlan(
        resources,
        assessment.assessment_digest,
        signal,
      );
      const id = crypto.randomUUID();
      if (phase !== "prepared")
        await Promise.all(
          (await f.client.submit([...plan.ops], { mutationId: id })).map(
            (write) => write.confirmed,
          ),
        );
      f.worker.intent = { version: 2, scope, mutationId: id, phase, plan };
      const submit = vi.spyOn(f.client, "submit");
      const repository = await f.owner.openCollection(scope.collection);
      expect(submit).not.toHaveBeenCalled();
      expect(f.worker.intent).toEqual({
        version: 2,
        scope,
        mutationId: id,
        phase,
        plan,
      });
      expect(f.worker.markerConfirmed).toBe(false);
      expect(await repository.modelSetup!.inspect()).toMatchObject({
        state: phase === "verified" ? "ready" : "outcome_unknown",
      });
      await repository.modelSetup!.resume();
      expect(await repository.modelSetup!.inspect()).toEqual({
        state: "ready",
      });
      expect(f.worker.intent).toEqual({
        version: 2,
        scope,
        mutationId: id,
        phase: "verified",
        plan,
      });
      expect(submit).toHaveBeenCalledTimes(phase === "prepared" ? 1 : 0);
      if (phase === "prepared") {
        expect(submit.mock.calls[0]![0]).toEqual(plan.ops);
        expect(submit.mock.calls[0]![1]).toMatchObject({ mutationId: id });
      }
      expect(
        f.worker.requests.filter(
          (request) => request.command.kind === "model-resource-setup-intent",
        ),
      ).toEqual([]);
      expect(f.worker.markerConfirmed).toBe(true);
    },
  );
  it("rejects a v2 reply to v3 preparation without replacing the owner or converting the original intent", async () => {
    const f = await fixture({ created: false });
    await f.owner.openCollection(scope.collection);
    const signal = new AbortController().signal;
    const resources = { "mdbase.yaml": 'spec_version: "0.3.0"\n' };
    const assessment = await nativeModelPackAssessment(resources, signal);
    const plan = await nativeModelPackPlan(
      resources,
      assessment.assessment_digest,
      signal,
    );
    const original = {
      version: 2 as const,
      scope,
      mutationId: crypto.randomUUID(),
      phase: "prepared" as const,
      plan,
    };
    f.worker.intent = original;
    const journal = f.owner.modelSetupJournal();
    await expect(
      journal.prepareResources(resourceSetupPlan(), signal),
    ).rejects.toThrow("binding unavailable");
    expect(f.worker.intent).toEqual(original);
    expect(f.worker.terminated).toBe(1);
    expect(
      f.worker.requests.filter(
        (request) => request.command.kind === "model-resource-setup-intent",
      ),
    ).toHaveLength(1);
    expect(
      f.worker.requests.filter(
        (request) => request.command.kind === "open-collection",
      ),
    ).toHaveLength(1);
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
  });
  it("retains a legacy intent without preparing, writing or completing its creator", async () => {
    const legacy = {
      version: 1 as const,
      scope,
      mutationId: "55555555-5555-4555-8555-555555555555",
      phase: "prepared" as const,
      ops: [
        {
          kind: "resource_put" as const,
          path: "_contracts/tasknotes.task.md",
          doc: "Original legacy contract",
          mustNotExist: true as const,
        },
        {
          kind: "resource_put" as const,
          path: "_types/task.md",
          doc: "Original legacy type",
          mustNotExist: true as const,
        },
      ] as const,
    };
    ControlWorker.initial = legacy;
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    const repository = await f.owner.openCollection(scope.collection);
    expect(await repository.modelSetup!.inspect()).toMatchObject({
      state: "blocked",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(f.worker.intent).toEqual(legacy);
    expect(f.worker.markerConfirmed).toBe(false);
    expect(
      f.worker.requests.filter(
        (request) =>
          request.command.kind === "model-setup-intent" &&
          request.command.action === "prepare",
      ),
    ).toHaveLength(0);
    expect(vi.mocked(connect)).toHaveBeenCalledOnce();
  });
  it("abort during explicit setup cannot complete a disposed creator or reattach foreground listeners", async () => {
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
    const repository = await f.owner.openCollection(scope.collection);
    const publish = repository.modelSetup!.install();
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
