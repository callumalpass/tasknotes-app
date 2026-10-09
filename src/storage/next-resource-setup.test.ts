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
    omitDiscovery: false,
    failInventory: false,
  };
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
        records: state.omitRecord
          ? [...records.values()].slice(1)
          : [...records.values()],
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
    client,
    setup,
  };
}
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("original resource setup sequencing (protocol stand-ins)", () => {
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
  it("holds verified original intent when current native inventory becomes unavailable", async () => {
    const f = fixture();
    await f.setup.install();
    const original = await f.journal.load(signal());
    f.state.failInventory = true;
    expect(await f.setup.inspect()).toMatchObject({ state: "outcome_unknown" });
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
  it("owner abort precedes readiness classification and never creates another intent", async () => {
    const f = fixture();
    f.owner.abort();
    await expect(f.setup.inspect()).rejects.toThrow();
    await expect(f.setup.install()).rejects.toThrow();
    expect(f.mocked.submit).not.toHaveBeenCalled();
  });
});
