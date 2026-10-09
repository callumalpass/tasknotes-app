// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import type {
  ModelPackPlan,
  ModelResourcePlan,
} from "../application/ports/model-setup";
import {
  decode,
  modelResourcePlan,
  NextModelSetupIntentStore,
} from "./next-model-setup-intent";

const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
const hash = "sha256:" + "ab".repeat(32);
const puts = [
  {
    kind: "resource_put" as const,
    path: "_types/task.md",
    doc: "Synthetic resource fixture",
    mustNotExist: true,
  },
];
const plan: ModelResourcePlan = {
  assessmentDigest: hash,
  provisionDigest: hash,
  packs: [
    { id: "tasknotes.task", version: "0.3.0-rc.18", digest: hash },
    { id: "obsidian.base", version: "1.0.0", digest: hash },
  ],
  resourceOps: puts,
  resourceReadback: puts.map(({ path, doc }) => ({ path, doc })),
  sources: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      path: "TaskNotes/Views/today.base",
      document: "views: [{type: tasknotesTaskList}]\n",
    },
  ],
};
const signal = () => new AbortController().signal;
const journal = () =>
  new NextModelSetupIntentStore({
    scope,
    appOrigin: "http://127.0.0.1:48319",
    cpOrigin: "https://connect-lab.mdbase.dev",
    isCurrent: () => true,
  });
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// Protected journal/data tests only; NOT native writes/receipt/READ/LAB evidence.
describe("resource setup in the original protected model ledger", () => {
  it("captures exact sources/UUIDs/ops before await and recovers monotonic v3 phases", async () => {
    const mutable = structuredClone(plan);
    const pending = journal().prepareResources(mutable, signal());
    (mutable.sources[0] as { id: string }).id = scope.collection;
    (mutable.sources[0] as { document: string }).document = "changed";
    const original = await pending;
    expect(original.version).toBe(3);
    expect(original.plan).toEqual(plan);
    expect(Object.isFrozen(original.plan.sources[0])).toBe(true);
    expect(await journal().prepareResources(plan, signal())).toEqual(original);
    const attempted = await journal().recordResourceAttempt(
      original.mutationId,
      signal(),
    );
    expect(await journal().load(signal())).toEqual(attempted);
    expect(
      await journal().recordResourceAttempt(original.mutationId, signal()),
    ).toEqual(attempted);
    await journal().recordResourceConfirmed(original.mutationId, signal());
    const verified = await journal().recordResourceVerified(
      original.mutationId,
      signal(),
    );
    expect(verified).toEqual({ ...original, phase: "verified" });
    expect(await journal().load(signal())).toEqual(verified);
    expect(await journal().prepareResources(plan, signal())).toEqual(verified);
  });
  it.each(["prepared", "attempted", "confirmed", "verified"] as const)(
    "never appends seeds to existing v2 %s",
    async (phase) => {
      const v2Plan: ModelPackPlan = {
        pack: plan.packs[0]!,
        assessmentDigest: hash,
        ops: puts,
        readback: plan.resourceReadback,
      };
      let original = await journal().prepare(v2Plan, signal());
      if (phase !== "prepared")
        original = await journal().recordAttempt(original.mutationId, signal());
      if (phase === "confirmed" || phase === "verified")
        original = await journal().recordConfirmed(
          original.mutationId,
          signal(),
        );
      if (phase === "verified")
        original = await journal().recordVerified(
          original.mutationId,
          signal(),
        );
      await expect(
        journal().prepareResources(plan, signal()),
      ).rejects.toMatchObject({ reason: "recovery_required" });
      await expect(
        journal().recordResourceAttempt(original.mutationId, signal()),
      ).rejects.toMatchObject({ reason: "recovery_required" });
      expect(await journal().load(signal())).toEqual(original);
      expect(await journal().prepare(v2Plan, signal())).toEqual(original);
    },
  );
  it("retains the original v1 decoder and holds it instead of conversion", () => {
    const value = {
      version: 1,
      scope,
      mutationId: scope.collection,
      phase: "prepared",
      ops: [
        {
          kind: "resource_put",
          path: "_contracts/task.md",
          doc: "legacy",
          mustNotExist: true,
        },
        {
          kind: "resource_put",
          path: "_types/task.md",
          doc: "legacy",
          mustNotExist: true,
        },
      ],
    };
    expect(decode(value, scope)).toEqual(value);
  });
  it("retains original v3 after lost reply and refuses new source bytes/IDs/plan", async () => {
    const original = await journal().prepareResources(plan, signal());
    await journal().recordResourceAttempt(original.mutationId, signal());
    for (const changed of [
      { ...plan, assessmentDigest: "sha256:" + "cd".repeat(32) },
      { ...plan, sources: [{ ...plan.sources[0]!, id: scope.collection }] },
      { ...plan, sources: [{ ...plan.sources[0]!, document: "replacement" }] },
    ])
      await expect(
        journal().prepareResources(changed, signal()),
      ).rejects.toMatchObject({ reason: "binding" });
    expect((await journal().load(signal()))!.mutationId).toBe(
      original.mutationId,
    );
    expect("remove" in journal()).toBe(false);
  });
  it("refuses duplicate paths/UUIDs, unguarded resources and operation/readback mismatch", () => {
    for (const changed of [
      { ...plan, sources: [plan.sources[0]!, plan.sources[0]!] },
      { ...plan, sources: [{ ...plan.sources[0]!, path: puts[0]!.path }] },
      {
        ...plan,
        sources: [
          { ...plan.sources[0]!, id: "00000000-0000-0000-0000-000000000000" },
        ],
      },
      { ...plan, resourceOps: [{ ...puts[0]!, mustNotExist: false }] },
      {
        ...plan,
        resourceReadback: [{ path: puts[0]!.path, doc: "different" }],
      },
    ])
      expect(() => modelResourcePlan(changed)).toThrow();
  });
  it("uses one existing nonextractable key through every v3 phase", async () => {
    const key = vi.spyOn(crypto.subtle, "generateKey");
    const original = await journal().prepareResources(plan, signal());
    await journal().recordResourceAttempt(original.mutationId, signal());
    await journal().recordResourceConfirmed(original.mutationId, signal());
    await journal().recordResourceVerified(original.mutationId, signal());
    expect(key).toHaveBeenCalledTimes(1);
    expect(await journal().load(signal())).toEqual({
      ...original,
      phase: "verified",
    });
  });
  it("refuses v2 mutators on v3, mismatched UUIDs/skipped phases/regressions", async () => {
    const original = await journal().prepareResources(plan, signal());
    await expect(
      journal().recordAttempt(original.mutationId, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    await expect(
      journal().recordResourceConfirmed(original.mutationId, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    await expect(
      journal().recordResourceAttempt(scope.collection, signal()),
    ).rejects.toMatchObject({ reason: "binding" });
    await journal().recordResourceAttempt(original.mutationId, signal());
    await journal().recordResourceConfirmed(original.mutationId, signal());
    await expect(
      journal().recordResourceAttempt(original.mutationId, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
  it("strict CAS permits only one concurrent v3 prepare and fences the loser", async () => {
    let arrivals = 0;
    let started!: () => void, release!: () => void;
    const both = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => {
      if (++arrivals === 2) started();
      await gate;
      return encrypt(...args);
    });
    const stores = [journal(), journal()];
    const pending = stores.map((store) =>
      store.prepareResources(plan, signal()),
    );
    await both;
    release();
    const results = await Promise.allSettled(pending);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex((r) => r.status === "rejected");
    expect(results[loser]).toMatchObject({
      status: "rejected",
      reason: { reason: "outcome_unknown" },
    });
    await expect(stores[loser]!.load(signal())).rejects.toMatchObject({
      reason: "fenced",
    });
    const winner = results.find((r) => r.status === "fulfilled");
    if (winner?.status !== "fulfilled")
      throw new Error("missing original CAS winner");
    expect(await journal().load(signal())).toEqual(winner.value);
  });
  it("refuses total plaintext/operation bounds and caller-created authority fields", async () => {
    expect(() =>
      journal().prepareResources(
        {
          ...plan,
          sources: [{ ...plan.sources[0]!, document: "x".repeat(512 * 1024) }],
        },
        signal(),
      ),
    ).toThrow();
    expect(() =>
      modelResourcePlan({ ...plan, resourceOps: Array(65).fill(puts[0]) }),
    ).toThrow();
    expect(() =>
      modelResourcePlan({ ...plan, collectionRevision: hash }),
    ).toThrow();
    expect(await journal().load(signal())).toBeNull();
  });
});
