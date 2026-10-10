// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { pinnedCoreBytes, sha256 } from "./next-resource-core.test-helper.mjs";
import { init, loadCatalog } from "mdbase";
import {
  MdbaseError,
  toValue,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import pin from "../../vendor/mdbase-browser.pin.json";
import { NextModelSetupIntentStore } from "../cloud/next-model-setup-intent";
import { taskNotesDefaultBaseSources } from "../domain/default-view-source";
import { NativeResourceSetup } from "./next-resource-setup";
import { NextTaskRepository } from "./next-repository";
import {
  captureResourceSetupPlan,
  nativeResourceSetupAssessment,
} from "./next-resource-plan";
import type { ModelPackPlan } from "../application/ports/model-setup";

vi.mock("../cloud/next-model-pack-core", () => ({
  initializeModelPackCore: async () => {
    const bytes = pinnedCoreBytes();
    expect(sha256(bytes)).toBe(pin.wasmSha256);
    expect(bytes.length).toBe(pin.wasmBytes);
    await init({ wasm: bytes });
  },
}));
const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
const digest = (source: string) => "sha256:" + sha256(source);
const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
const notFound = () =>
  new MdbaseError({
    code: "not_found",
    recovery: "refresh",
    message: "Synthetic missing record/resource",
  });
const signal = () => new AbortController().signal;

/** Actual Core/publisher data + real protected journal crypto; all RPCs, native
 * discovery, receipts and IDB transactions below are protocol stand-ins. NOT
 * native atomicity, live permission/custody/runtime/artifact or LAB qualification.
 */
function fixture() {
  const owner = new AbortController();
  const journal = new NextModelSetupIntentStore({
    scope,
    appOrigin: "http://127.0.0.1:48319",
    cpOrigin: "https://connect-lab.mdbase.dev",
    isCurrent: () => !owner.signal.aborted,
  });
  const resources = new Map([
    [
      "mdbase.yaml",
      "spec_version: '0.3.0'\nsettings:\n  record_extensions: [md, txt]\nx-user: keep\n",
    ],
  ]);
  const records = new Map<string, wire.RecordView>();
  const receipts = new Map<string, wire.Receipt>();
  const state = {
    loseReply: false,
    reject: undefined as wire.Problem | undefined,
    omitRecord: false,
    omitReceiptRecords: false,
    omitDiscovery: false,
    failInventory: false,
  };
  let markSubmitted!: () => void;
  const submitted = new Promise<void>((resolve) => {
    markSubmitted = resolve;
  });
  const factory = vi.fn(taskNotesDefaultBaseSources);
  const verified = vi.fn(async () => undefined);
  const resource = (path: string, text: string): wire.ResourceView => ({
    path,
    text,
    state: "confirmed",
    revision: digest(text),
    size: new TextEncoder().encode(text).byteLength,
  });
  const views = () =>
    [...records.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        record: r.id,
        path: r.path,
        sourceRevision: r.revision,
        ordinal: 0,
        name: "Synthetic view",
        viewType: "tasknotesTaskList",
        implementations: [],
      }));
  const mocked = {
    onStatus: vi.fn(() => vi.fn()),
    onHolds: vi.fn(() => vi.fn()),
    onLink: vi.fn(() => vi.fn()),
    hello: {
      collection: scope.collection,
      grant: {
        role: "owner",
        capabilities: [
          "collection.read",
          "definitions.manage",
          "records.create",
        ],
      },
    },
    resources: {
      list: vi.fn(async () => {
        if (state.failInventory)
          throw new MdbaseError({
            code: "unavailable",
            reason: "resource_inventory_unavailable",
            recovery: "retry",
            message: "Synthetic unavailable inventory",
          });
        return {
          resources: [...resources].map(([path, source]) =>
            resource(path, source),
          ),
          complete: true,
        };
      }),
      get: vi.fn(async (path: string) => {
        const text = resources.get(path);
        if (text === undefined) throw notFound();
        return resource(path, text);
      }),
    },
    describe: vi.fn(async () => {
      const catalog = await loadCatalog(Object.fromEntries(resources));
      return {
        contracts: catalog.contracts.map((c) => ({
          id: c.id,
          version: c.version,
          digest: c.digest,
        })),
        types: catalog.types.map((t) => ({
          name: t.name,
          path: t.path,
          implements: catalog.implementations
            .filter((i) => i.type === t.name)
            .map((i) => ({
              contract: i.contract,
              version: i.version,
              fields: i.fields,
              binding: toValue(JSON.parse(JSON.stringify(i.binding))),
            })),
        })),
      };
    }),
    get: vi.fn(async (ref: string | { path: string }) => {
      const r =
        typeof ref === "string"
          ? records.get(ref)
          : [...records.values()].find((r) => r.path === ref.path);
      if (!r) throw notFound();
      return structuredClone(r);
    }),
    listAppBasesViews: vi.fn(async () => ({
      kind: "success",
      views: state.omitDiscovery ? views().slice(1) : views(),
      clock,
      collectionRevision: digest("synthetic native cut"),
      continuation: null,
    })),
    readAppBasesViewSource: vi.fn(async (selection: { record: string }) => {
      const record = records.get(selection.record);
      if (!record) throw notFound();
      return {
        kind: "success",
        view: views().find((v) => v.record === selection.record)!,
        source: record.document!,
        clock,
        collectionRevision: digest("synthetic native cut"),
      };
    }),
    submit: vi.fn(async (ops: wire.Op[], options: { mutationId: string }) => {
      markSubmitted();
      if (state.reject) {
        receipts.set(options.mutationId, {
          mutation: options.mutationId,
          state: "rejected",
          problem: state.reject,
        });
        throw new MdbaseError(state.reject);
      }
      // Stand-in acceptance only; does not model native atomic planning/guards.
      for (const op of ops) {
        if (op.kind === "resource_put") resources.set(op.path, op.doc);
        else if (op.kind === "resource_delete") resources.delete(op.path);
        else if (op.kind === "create")
          records.set(op.id, {
            id: op.id,
            path: op.path!,
            document: op.document!,
            revision: digest(op.document!),
            frontmatter: new Map(),
            types: ["obsidian_base"],
            state: { state: "confirmed", confirmedSeq: 1 },
          });
        else throw new Error("unexpected original operation");
      }
      const receipt: wire.Receipt = {
        mutation: options.mutationId,
        state: "confirmed",
        status: "applied",
        seq: 1,
        ...(state.omitReceiptRecords
          ? {}
          : {
              records: state.omitRecord
                ? [...records.values()].slice(1)
                : [...records.values()],
            }),
      };
      receipts.set(options.mutationId, receipt);
      if (state.loseReply)
        throw new Error("Synthetic lost reply after acceptance");
      return [
        {
          receipt: { mutation: options.mutationId, state: "pending" },
          confirmed: Promise.resolve(receipt),
        },
      ];
    }),
    awaitReceipt: vi.fn(async (id: string) => {
      const r = receipts.get(id);
      if (!r) throw new Error("Synthetic unknown receipt");
      return r;
    }),
  };
  const client = mocked as unknown as MdbaseClient;
  const setup = new NativeResourceSetup(
    client,
    journal,
    () => owner.signal,
    factory,
    verified,
  );
  return {
    owner,
    journal,
    resources,
    records,
    receipts,
    state,
    factory,
    verified,
    mocked,
    submitted,
    client,
    setup,
  };
}
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("original resource setup sequencing (protocol stand-ins)", () => {
  function fakeSetupClock() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const owner = new AbortController();
      setTimeout(
        () => owner.abort(new DOMException("signal timed out", "TimeoutError")),
        ms,
      );
      return owner.signal;
    });
  }
  it("pins an explicit resource action before the queue yields; renewal cannot move it to a new owner", async () => {
    const f = fixture();
    let current = f.owner;
    const ownerSignal = vi.fn(() => current.signal);
    const setup = new NativeResourceSetup(
      f.client,
      f.journal,
      ownerSignal,
      f.factory,
      f.verified,
    );
    const load = vi.spyOn(f.journal, "load"),
      uuid = vi.spyOn(crypto, "randomUUID");
    const result = setup.install(),
      stopped = expect(result).rejects.toThrow();
    f.owner.abort();
    current = new AbortController();
    await stopped;
    expect(ownerSignal).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.mocked.submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("slow original confirmation survives 20s with one unchanged resource/source submit", async () => {
    const f = fixture();
    await f.setup.inspect();
    fakeSetupClock();
    const original = f.mocked.submit.getMockImplementation()!;
    f.mocked.submit.mockImplementationOnce(async (...args) => {
      const writes = await original(...args),
        receipt = await writes[0]!.confirmed;
      return [
        {
          ...writes[0]!,
          confirmed: new Promise<typeof receipt>((resolve) =>
            setTimeout(() => resolve(receipt), 35000),
          ),
        },
      ];
    });
    const progress = vi.fn(),
      done = vi.fn();
    const result = f.setup.install(progress).then(done);
    await f.submitted;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(21000);
    expect(done).not.toHaveBeenCalled();
    const originalIntent = (await f.journal.load(f.owner.signal))!;
    expect(originalIntent.phase).toBe("attempted");
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.mocked.awaitReceipt).not.toHaveBeenCalled();
    expect(await f.journal.load(f.owner.signal)).toMatchObject({
      ...originalIntent,
      phase: "verified",
    });
    expect(progress).toHaveBeenCalledWith("waiting_for_confirmation");
    expect(f.verified).toHaveBeenCalledOnce();
  });
  it("setup timeout checks the exact original receipt and readback without resubmitting", async () => {
    const f = fixture();
    await f.setup.inspect();
    fakeSetupClock();
    const original = f.mocked.submit.getMockImplementation()!;
    f.mocked.submit.mockImplementationOnce(async (...args) => {
      const writes = await original(...args);
      return [
        { ...writes[0]!, confirmed: new Promise<wire.Receipt>(() => {}) },
      ];
    });
    const progress = vi.fn(),
      result = f.setup.install(progress);
    await f.submitted;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    const originalIntent = (await f.journal.load(f.owner.signal))!;
    await vi.advanceTimersByTimeAsync(120000);
    await result;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.mocked.awaitReceipt).toHaveBeenCalledWith(
      originalIntent.mutationId,
      120000,
      expect.any(AbortSignal),
    );
    expect(await f.journal.load(f.owner.signal)).toMatchObject({
      ...originalIntent,
      phase: "verified",
    });
    expect(f.verified).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith("checking_outcome");
  });
  it("keeps a pending original receipt attempted across deadline recovery and explicit resume, without a new UUID or submit", async () => {
    const f = fixture();
    await f.setup.inspect();
    fakeSetupClock();
    const uuid = vi.spyOn(crypto, "randomUUID"),
      original = f.mocked.submit.getMockImplementation()!;
    f.mocked.submit.mockImplementationOnce(async (...args) => {
      const writes = await original(...args);
      return [
        { ...writes[0]!, confirmed: new Promise<wire.Receipt>(() => {}) },
      ];
    });
    f.mocked.awaitReceipt.mockImplementation(async (mutation) => ({
      mutation,
      state: "pending",
    }));
    const progress = vi.fn(),
      result = f.setup.install(progress);
    const unknown = expect(result).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    await f.submitted;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    const originalIntent = (await f.journal.load(f.owner.signal))!,
      count = uuid.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    await unknown;
    expect(await f.journal.load(f.owner.signal)).toEqual(originalIntent);
    expect(f.mocked.awaitReceipt).toHaveBeenCalledWith(
      originalIntent.mutationId,
      120000,
      expect.any(AbortSignal),
    );
    expect(progress).toHaveBeenLastCalledWith("checking_outcome");
    expect(f.verified).not.toHaveBeenCalled();
    expect(uuid).toHaveBeenCalledTimes(count);
    expect(await f.setup.inspect()).toMatchObject({ state: "outcome_unknown" });
    await expect(f.setup.resume()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(uuid).toHaveBeenCalledTimes(count);
    expect(await f.journal.load(f.owner.signal)).toEqual(originalIntent);
  });
  it("does not finish or recover after the original owner ends during receipt reconciliation", async () => {
    const f = fixture();
    await f.setup.inspect();
    fakeSetupClock();
    const original = f.mocked.submit.getMockImplementation()!;
    f.mocked.submit.mockImplementationOnce(async (...args) => {
      const writes = await original(...args);
      return [
        { ...writes[0]!, confirmed: new Promise<wire.Receipt>(() => {}) },
      ];
    });
    let reply!: (receipt: wire.Receipt) => void,
      markReconciliation!: () => void;
    const reconciliationStarted = new Promise<void>((resolve) => {
      markReconciliation = resolve;
    });
    f.mocked.awaitReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
          markReconciliation();
        }),
    );
    const result = f.setup.install(),
      stopped = expect(result).rejects.toThrow();
    await f.submitted;
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    const originalIntent = (await f.journal.load(f.owner.signal))!;
    await vi.advanceTimersByTimeAsync(120000);
    await reconciliationStarted;
    expect(f.mocked.awaitReceipt).toHaveBeenCalledOnce();
    f.owner.abort();
    await stopped;
    reply(f.receipts.get(originalIntent.mutationId)!);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.verified).not.toHaveBeenCalled();
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.mocked.get).not.toHaveBeenCalled();
  });
  it("inspects without UUID/prepare/submit and requires real full-scope source creation grant", async () => {
    const f = fixture(),
      uuid = vi.spyOn(crypto, "randomUUID");
    expect(await f.setup.inspect()).toEqual({ state: "required" });
    expect(uuid).not.toHaveBeenCalled();
    expect(await f.journal.load(signal())).toBeNull();
    expect(f.mocked.submit).not.toHaveBeenCalled();
    f.mocked.hello.grant.capabilities = [
      "collection.read",
      "definitions.manage",
    ];
    expect(await f.setup.inspect()).toMatchObject({
      state: "permission_required",
    });
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "permission_required" },
    });
    expect(uuid).not.toHaveBeenCalled();
    expect(await f.journal.load(signal())).toBeNull();
  });
  it("wires the real extended journal port into the repository without enabling source writes", async () => {
    const f = fixture();
    const repository = new NextTaskRepository(
      f.client,
      "Synthetic collection",
      scope.account,
      { modelSetupJournal: f.journal, onModelSetupVerified: f.verified },
    );
    expect(await repository.modelSetup!.inspect()).toEqual({
      state: "required",
    });
    await repository.modelSetup!.install();
    expect((await f.journal.load(signal()))?.version).toBe(3);
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    expect(
      f.mocked.submit.mock.calls[0]![0].filter((op) => op.kind === "create"),
    ).toHaveLength(5);
    expect(repository.defaultViewSourceCreation).toBe("explicit-only");
    expect(f.verified).toHaveBeenCalledTimes(1);
  });
  it("submits all original Core ops plus five explicit UUID/path/raw-document Creates in ONE mutation", async () => {
    const f = fixture();
    await f.setup.install();
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    const original = await f.journal.load(signal());
    if (original?.version !== 3) throw new Error("missing original v3 intent");
    expect(original.phase).toBe("verified");
    const [ops, options] = f.mocked.submit.mock.calls[0]!;
    expect(options.mutationId).toBe(original.mutationId);
    expect(ops).toEqual([
      ...original.plan.resourceOps,
      ...original.plan.sources.map((s) => ({
        kind: "create",
        id: s.id,
        path: s.path,
        document: s.document,
      })),
    ]);
    expect(original.plan.sources).toHaveLength(5);
    expect(f.mocked.readAppBasesViewSource).toHaveBeenCalledTimes(5);
    expect(f.verified).toHaveBeenCalledTimes(1);
  });
  it("recovers UNKNOWN only through the SAME original receipt, never rechecks/regenerates/remints/resubmits", async () => {
    const f = fixture();
    f.state.loseReply = true;
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const original = await f.journal.load(signal());
    expect(original?.phase).toBe("attempted");
    expect(f.verified).not.toHaveBeenCalled();
    const uuid = vi.spyOn(crypto, "randomUUID");
    await f.setup.resume();
    expect(f.mocked.awaitReceipt).toHaveBeenCalledWith(
      original!.mutationId,
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(uuid).not.toHaveBeenCalled();
    expect(await f.journal.load(signal())).toEqual({
      ...original,
      phase: "verified",
    });
  });
  it.each(["attempted", "confirmed"] as const)(
    "a fresh service resumes the sealed original %s intent after its owner closes without new admission",
    async (phase) => {
      const f = fixture();
      f.state.loseReply = phase === "attempted";
      f.state.omitDiscovery = phase === "confirmed";
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "outcome_unknown" },
      });
      const original = await f.journal.load(signal());
      if (original?.version !== 3 || original.phase !== phase)
        throw new Error("missing original held v3 intent");
      expect(f.mocked.submit).toHaveBeenCalledOnce();
      expect(f.factory).toHaveBeenCalledOnce();
      expect(f.verified).not.toHaveBeenCalled();
      f.owner.abort();
      f.journal.close();

      const owner = new AbortController();
      const journal = new NextModelSetupIntentStore({
        scope,
        appOrigin: "http://127.0.0.1:48319",
        cpOrigin: "https://connect-lab.mdbase.dev",
        isCurrent: () => !owner.signal.aborted,
      });
      const verified = vi.fn(async () => undefined);
      // A new protocol client/service, not the old owner's result callback.
      // The shared stand-in authority retains its records and original receipt.
      const client = { ...f.mocked } as unknown as MdbaseClient;
      const setup = new NativeResourceSetup(
        client,
        journal,
        () => owner.signal,
        f.factory,
        verified,
      );
      f.state.loseReply = false;
      f.state.omitDiscovery = false;
      f.mocked.submit.mockClear();
      f.mocked.awaitReceipt.mockClear();
      f.mocked.get.mockClear();
      f.factory.mockClear();
      const uuid = vi.spyOn(crypto, "randomUUID");

      expect(await journal.load(signal())).toEqual(original);
      expect(await setup.inspect()).toMatchObject({ state: "outcome_unknown" });
      await setup.resume();
      expect(f.mocked.awaitReceipt).toHaveBeenCalledExactlyOnceWith(
        original.mutationId,
        120000,
        expect.any(AbortSignal),
      );
      for (const source of original.plan.sources) {
        expect(f.mocked.get).toHaveBeenCalledWith(
          source.id,
          { document: true },
          expect.any(AbortSignal),
        );
        expect(f.mocked.get).toHaveBeenCalledWith(
          { path: source.path },
          { document: true },
          expect.any(AbortSignal),
        );
      }
      expect(f.mocked.submit).not.toHaveBeenCalled();
      expect(f.factory).not.toHaveBeenCalled();
      expect(uuid).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
      expect(verified).toHaveBeenCalledOnce();
      expect(await journal.load(signal())).toEqual({
        ...original,
        phase: "verified",
      });
      expect(await setup.inspect()).toEqual({ state: "ready" });
      owner.abort();
      journal.close();
    },
  );
  async function heldWithoutReceiptRecords() {
    const f = fixture();
    f.state.omitReceiptRecords = true;
    f.state.loseReply = true;
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const original = await f.journal.load(signal());
    if (original?.version !== 3 || original.phase !== "attempted")
      throw new Error("missing original attempted v3 intent");
    expect(f.receipts.get(original.mutationId)).not.toHaveProperty("records");
    return { f, original };
  }
  it("finishes the original applied receipt with omitted records only after exact bounded readback", async () => {
    const { f, original } = await heldWithoutReceiptRecords();
    const uuid = vi.spyOn(crypto, "randomUUID");
    const confirm = vi.spyOn(f.journal, "recordResourceConfirmed");
    const nativeRead = f.mocked.readAppBasesViewSource.getMockImplementation()!;
    f.mocked.readAppBasesViewSource.mockImplementation(async (selection) => {
      // Even the last native source must be verified before phase advancement.
      expect(await f.journal.load(signal())).toEqual(original);
      expect(confirm).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
      return nativeRead(selection);
    });
    await f.setup.resume();
    expect(f.mocked.awaitReceipt).toHaveBeenCalledWith(
      original.mutationId,
      120000,
      expect.any(AbortSignal),
    );
    for (const source of original.plan.sources) {
      expect(f.mocked.get).toHaveBeenCalledWith(
        source.id,
        { document: true },
        expect.any(AbortSignal),
      );
      expect(f.mocked.get).toHaveBeenCalledWith(
        { path: source.path },
        { document: true },
        expect.any(AbortSignal),
      );
    }
    expect(f.mocked.readAppBasesViewSource).toHaveBeenCalledTimes(5);
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.verified).toHaveBeenCalledOnce();
    expect(await f.journal.load(signal())).toEqual({
      ...original,
      phase: "verified",
    });
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.factory).toHaveBeenCalledOnce();
    expect(uuid).not.toHaveBeenCalled();
  });
  it("never advances omitted-record fallback after the original owner ends during readback", async () => {
    const { f, original } = await heldWithoutReceiptRecords();
    const confirm = vi.spyOn(f.journal, "recordResourceConfirmed");
    const nativeRead = f.mocked.readAppBasesViewSource.getMockImplementation()!;
    f.mocked.readAppBasesViewSource.mockImplementation(async (selection) => {
      const result = await nativeRead(selection);
      f.owner.abort();
      return result;
    });
    await f.setup.resume().then(
      () => {
        throw new Error("owner abort was masked");
      },
      (reason) => expect(reason).toBe(f.owner.signal.reason),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    const reopened = new NextModelSetupIntentStore({
      scope,
      appOrigin: "http://127.0.0.1:48319",
      cpOrigin: "https://connect-lab.mdbase.dev",
      isCurrent: () => true,
    });
    expect(await reopened.load(signal())).toEqual(original);
  });
  it.each([
    "resource",
    "source-id",
    "source-path",
    "source-document",
    "pending-source",
    "inventory",
    "discovery",
  ] as const)(
    "retains ATTEMPTED with omitted receipt records and %s readback mismatch/refusal",
    async (mismatch) => {
      const { f, original } = await heldWithoutReceiptRecords();
      const uuid = vi.spyOn(crypto, "randomUUID");
      const confirm = vi.spyOn(f.journal, "recordResourceConfirmed");
      const source = original.plan.sources[0]!;
      const record = f.records.get(source.id)!;
      if (mismatch === "resource") {
        const resource = original.plan.resourceReadback.find(
          (r) => r.doc !== null,
        )!;
        f.resources.set(resource.path, resource.doc! + "\nx-drift: changed\n");
      }
      if (mismatch === "source-id") record.id = scope.collection;
      if (mismatch === "source-path") record.path = "wrong.base";
      if (mismatch === "source-document") record.document += "\n# drift\n";
      if (mismatch === "pending-source")
        record.state = { state: "pending", confirmedSeq: 1 };
      if (mismatch === "inventory") f.state.failInventory = true;
      if (mismatch === "discovery") f.state.omitDiscovery = true;
      await expect(f.setup.resume()).rejects.toMatchObject({
        view: {
          state: "outcome_unknown",
          message:
            "Preserve this collection and resume its original resource setup. Confirmation or exact native readback is unfinished.",
        },
      });
      expect(await f.journal.load(signal())).toEqual(original);
      expect(confirm).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
      expect(f.mocked.submit).toHaveBeenCalledOnce();
      expect(f.factory).toHaveBeenCalledOnce();
      expect(uuid).not.toHaveBeenCalled();
    },
  );
  it.each([
    "wrong-mutation",
    "rejected",
    "pending",
    "conflicted",
    "conflicts",
    "merged",
    "no-status",
  ] as const)(
    "does not use omitted-record fallback for %s original receipt",
    async (invalid) => {
      const { f, original } = await heldWithoutReceiptRecords();
      const receipt = f.receipts.get(original.mutationId)!;
      if (invalid === "wrong-mutation") receipt.mutation = scope.collection;
      if (invalid === "rejected") receipt.state = "rejected";
      if (invalid === "pending") receipt.state = "pending";
      if (invalid === "conflicted") receipt.status = "conflicted";
      if (invalid === "conflicts")
        receipt.conflicts = [
          {
            kind: "path",
            id: original.plan.sources[0]!.id,
            kept: { form: "text", text: "original.base" },
            lost: { form: "text", text: "wrong.base" },
          },
        ];
      if (invalid === "merged") receipt.status = "merged";
      if (invalid === "no-status") delete receipt.status;
      f.mocked.get.mockClear();
      f.mocked.resources.list.mockClear();
      await expect(f.setup.resume()).rejects.toThrow();
      expect(await f.journal.load(signal())).toEqual(original);
      expect(f.mocked.get).not.toHaveBeenCalled();
      expect(f.mocked.resources.list).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
      expect(f.mocked.submit).toHaveBeenCalledOnce();
    },
  );
  it("retains native path refusal without retry, fallback or replacement UUID", async () => {
    const f = fixture();
    f.state.reject = {
      code: "conflict",
      reason: "path_taken",
      recovery: "resolve_conflict",
      message: "Synthetic occupied original source path",
    };
    await expect(f.setup.install()).rejects.toMatchObject({
      code: "conflict",
      reason: "path_taken",
    });
    const original = await f.journal.load(signal());
    expect(original?.phase).toBe("attempted");
    await expect(f.setup.resume()).rejects.toMatchObject({
      code: "conflict",
      reason: "path_taken",
    });
    expect((await f.journal.load(signal()))!.mutationId).toBe(
      original!.mutationId,
    );
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("blocks prepared resource drift before attempt while retaining every original UUID/source", async () => {
    const f = fixture();
    const plan = captureResourceSetupPlan(
      await nativeResourceSetupAssessment(
        Object.fromEntries(f.resources),
        f.client,
        f.factory,
        signal(),
      ),
    );
    const original = await f.journal.prepareResources(plan, signal());
    f.resources.set(
      "mdbase.yaml",
      f.resources.get("mdbase.yaml")! + "x-new: changed\n",
    );
    await expect(f.setup.resume()).rejects.toMatchObject({
      code: "concurrent_modification",
    });
    expect(await f.journal.load(signal())).toEqual(original);
    expect(f.mocked.submit).not.toHaveBeenCalled();
    expect(f.factory).toHaveBeenCalledTimes(1);
  });
  it.each(["receipt", "discovery", "record"] as const)(
    "does not mark complete with missing/mismatched %s evidence",
    async (missing) => {
      const f = fixture();
      if (missing === "receipt") f.state.omitRecord = true;
      if (missing === "discovery") f.state.omitDiscovery = true;
      if (missing === "record")
        f.mocked.get.mockImplementation(async () => ({
          id: scope.collection,
          path: "wrong.base",
          revision: digest("wrong"),
          document: "wrong",
          frontmatter: new Map(),
          types: ["obsidian_base"],
          state: { state: "confirmed" as const, confirmedSeq: 1 },
        }));
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "outcome_unknown" },
      });
      expect((await f.journal.load(signal()))!.phase).not.toBe("verified");
      expect(f.verified).not.toHaveBeenCalled();
      expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["pending", "unresolved"] as const)(
    "holds original confirmation when native record state is %s",
    async (state) => {
      const f = fixture();
      const get = f.mocked.get.getMockImplementation()!;
      f.mocked.get.mockImplementation(async (ref) => ({
        ...(await get(ref)),
        state: {
          state: state === "pending" ? "pending" : "confirmed",
          confirmedSeq: 1,
          unresolved: state === "unresolved" ? 1 : undefined,
        },
      }));
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "outcome_unknown" },
      });
      expect((await f.journal.load(signal()))!.phase).toBe("confirmed");
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it("holds verified original intent when current native inventory becomes unavailable", async () => {
    const f = fixture();
    await f.setup.install();
    const original = await f.journal.load(signal());
    f.state.failInventory = true;
    expect(await f.setup.inspect()).toMatchObject({ state: "blocked" });
    expect(await f.journal.load(signal())).toEqual(original);
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
  });
  it("does not convert or append to the existing v2 plan", async () => {
    const f = fixture();
    const legacy: ModelPackPlan = {
      pack: {
        id: "tasknotes.task",
        version: "0.3.0-rc.18",
        digest: digest("synthetic pack"),
      },
      assessmentDigest: digest("synthetic assessment"),
      ops: [
        {
          kind: "resource_put",
          path: "_types/task.md",
          doc: "synthetic",
          mustNotExist: true,
        },
      ],
      readback: [{ path: "_types/task.md", doc: "synthetic" }],
    };
    const original = await f.journal.prepare(legacy, signal());
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    await expect(f.setup.resume()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(await f.journal.load(signal())).toEqual(original);
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.mocked.submit).not.toHaveBeenCalled();
  });
  it("delegates original v2 actions without generation, slot replacement or a new foreground budget", async () => {
    const f = fixture();
    const plan: ModelPackPlan = {
      pack: {
        id: "tasknotes.task",
        version: "0.3.0-rc.18",
        digest: digest("synthetic pack"),
      },
      assessmentDigest: digest("synthetic assessment"),
      ops: [
        {
          kind: "resource_put",
          path: "_types/task.md",
          doc: "synthetic",
          mustNotExist: true,
        },
      ],
      readback: [{ path: "_types/task.md", doc: "synthetic" }],
    };
    const original = await f.journal.prepare(plan, signal());
    const old = {
      inspect: vi.fn(async () => ({
        state: "outcome_unknown" as const,
        message: "original v2",
      })),
      install: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
    };
    const signals: AbortSignal[] = [];
    const setup = new NativeResourceSetup(
      f.client,
      f.journal,
      () => f.owner.signal,
      f.factory,
      f.verified,
      (deadline) => {
        signals.push(deadline);
        return old;
      },
    );
    expect(await setup.inspect()).toEqual({
      state: "outcome_unknown",
      message: "original v2",
    });
    await setup.install();
    await setup.resume();
    expect(old.inspect).toHaveBeenCalledTimes(1);
    expect(old.install).toHaveBeenCalledTimes(1);
    expect(old.resume).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    expect(await f.journal.load(signal())).toEqual(original);
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.mocked.submit).not.toHaveBeenCalled();
    f.owner.abort();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  it("does not mask a mid-submit owner abort as unavailable or readiness; original intent remains held", async () => {
    const f = fixture();
    const accept = f.mocked.submit.getMockImplementation()!;
    f.mocked.submit.mockImplementation(async (ops, options) => {
      const writes = await accept(ops, options);
      f.owner.abort();
      return writes;
    });
    await f.setup.install().then(
      () => {
        throw new Error("owner abort was masked");
      },
      (reason) => expect(reason).toBe(f.owner.signal.reason),
    );
    expect(f.mocked.submit).toHaveBeenCalledTimes(1);
    expect(f.verified).not.toHaveBeenCalled();
    const reopen = new NextModelSetupIntentStore({
      scope,
      appOrigin: "http://127.0.0.1:48319",
      cpOrigin: "https://connect-lab.mdbase.dev",
      isCurrent: () => true,
    });
    const original = await reopen.load(signal());
    expect(original?.phase).toBe("attempted");
    if (original?.version !== 3) throw new Error("missing held original");
    expect(original.plan.sources.map((s) => s.id)).toEqual([
      ...f.records.keys(),
    ]);
  });
  it.each(["inspect", "install", "resume"] as const)(
    "%s fences a readable old prefix before journal, source planning or writes",
    async (action) => {
      const f = fixture();
      Object.defineProperty(f.client, "status", {
        value: {
          mode: "synced",
          connection: "online",
          pending: 0,
          confirmedThrough: 2,
          headKnown: 5,
          incidents: [{ kind: "waiting_for_key" }],
        },
      });
      const load = vi.spyOn(f.journal, "load");
      const uuid = vi.spyOn(crypto, "randomUUID");
      if (action === "inspect")
        await expect(f.setup.inspect()).resolves.toMatchObject({
          state: "waiting",
          reason: "waiting_for_access",
        });
      else
        await expect(f.setup[action]()).rejects.toMatchObject({
          view: { state: "waiting", reason: "waiting_for_access" },
        });
      expect(load).not.toHaveBeenCalled();
      expect(f.mocked.resources.list).not.toHaveBeenCalled();
      expect(f.factory).not.toHaveBeenCalled();
      expect(uuid).not.toHaveBeenCalled();
      expect(f.mocked.submit).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
      await expect(f.journal.load(signal())).resolves.toBeNull();
    },
  );
  it("key wait preserves verified history and current readiness still requires complete native reads", async () => {
    const f = fixture();
    await f.setup.install();
    const original = await f.journal.load(signal());
    expect(original?.phase).toBe("verified");
    const current = {
      confirmedThrough: 2,
      headKnown: 5,
      incidents: [{ kind: "waiting_for_key" }],
    };
    Object.defineProperty(f.client, "status", { get: () => current });
    await expect(f.setup.inspect()).resolves.toMatchObject({
      state: "waiting",
    });
    await expect(f.journal.load(signal())).resolves.toEqual(original);
    current.confirmedThrough = 5;
    current.incidents = [];
    await expect(f.setup.inspect()).resolves.toEqual({ state: "ready" });
    f.mocked.resources.get.mockRejectedValueOnce(notFound());
    await expect(f.setup.inspect()).resolves.toMatchObject({
      state: "blocked",
    });
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.verified).toHaveBeenCalledOnce();
    await expect(f.journal.load(signal())).resolves.toEqual(original);
  });
  it("catch-up after prepare retains that exact prepared intent without submitting or automatically resuming", async () => {
    const f = fixture();
    const current = { confirmedThrough: 5, headKnown: 5, incidents: [] };
    Object.defineProperty(f.client, "status", { get: () => current });
    const prepare = f.journal.prepareResources.bind(f.journal);
    vi.spyOn(f.journal, "prepareResources").mockImplementation(
      async (plan, owner) => {
        const intent = await prepare(plan, owner);
        current.headKnown = 6;
        return intent;
      },
    );
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "waiting", reason: "catching_up" },
    });
    const original = await f.journal.load(signal());
    expect(original?.phase).toBe("prepared");
    expect(f.mocked.submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
    current.confirmedThrough = 6;
    await expect(f.setup.inspect()).resolves.toMatchObject({
      state: "outcome_unknown",
    });
    await expect(f.journal.load(signal())).resolves.toEqual(original);
    expect(f.mocked.submit).not.toHaveBeenCalled();
    await f.setup.resume();
    expect(f.mocked.submit).toHaveBeenCalledOnce();
    expect(f.mocked.submit.mock.calls[0]?.[1].mutationId).toBe(
      original?.mutationId,
    );
    expect((await f.journal.load(signal()))?.phase).toBe("verified");
  });
  it("cleared catch-up does not automatically install on a genuinely unconfigured collection", async () => {
    const f = fixture();
    const current = { confirmedThrough: 2, headKnown: 5, incidents: [] };
    Object.defineProperty(f.client, "status", { get: () => current });
    await expect(f.setup.inspect()).resolves.toMatchObject({
      state: "waiting",
    });
    current.confirmedThrough = 5;
    await expect(f.setup.inspect()).resolves.toEqual({ state: "required" });
    expect(f.mocked.submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
    await expect(f.journal.load(signal())).resolves.toBeNull();
  });
  it("owner abort precedes readiness classification and never creates another intent", async () => {
    const f = fixture();
    f.owner.abort();
    await expect(f.setup.inspect()).rejects.toThrow();
    await expect(f.setup.install()).rejects.toThrow();
    expect(f.mocked.submit).not.toHaveBeenCalled();
  });
});
