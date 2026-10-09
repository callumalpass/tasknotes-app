// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import type { ModelDefinitionOps } from "../application/ports/model-setup";
import { NextModelSetupIntentStore } from "./next-model-setup-intent";
const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
const appOrigin = "http://127.0.0.1:48319",
  cpOrigin = "https://connect-lab.mdbase.dev";
const ops: ModelDefinitionOps = [
  {
    kind: "resource_put",
    path: "_contracts/tasknotes.task.md",
    doc: "Synthetic inline contract definition",
    mustNotExist: true,
  },
  {
    kind: "resource_put",
    path: "_types/task.md",
    doc: "Synthetic inline implementing type",
    mustNotExist: true,
  },
];
const signal = () => new AbortController().signal;
const journal = (bound = scope, isCurrent = () => true) =>
  new NextModelSetupIntentStore({
    scope: bound,
    appOrigin,
    cpOrigin,
    isCurrent,
  });
const namespace = (bound = scope) =>
  JSON.stringify([
    appOrigin,
    cpOrigin,
    "tasknotes-web",
    bound.account,
    bound.installation,
    bound.collection,
  ]);
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tasknotes.native-model-setup.v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function row(key = namespace()) {
  const db = await database();
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction("original-model-operation", "readonly"),
        request = tx.objectStore("original-model-operation").get(key);
      tx.oncomplete = () => resolve(request.result as Record<string, unknown>);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function replace(value: unknown, key = namespace()) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("original-model-operation", "readwrite");
      tx.objectStore("original-model-operation").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// IDB/WebCrypto stand-ins only: not native model write/receipt/READ/LAB proof.
describe("fixed protected model setup intent", () => {
  it("commits one immutable original plan/UUID, recovers every monotonic phase, and exposes no reset", async () => {
    const store = journal();
    expect(await store.load(signal())).toBeNull();
    const original = await store.prepare(ops, signal());
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(original.ops[0])).toBe(true);
    expect(await journal().prepare(ops, signal())).toEqual(original);
    const attempted = await store.recordAttempt(original.mutationId, signal());
    expect(await journal().load(signal())).toEqual(attempted);
    expect(await store.recordAttempt(original.mutationId, signal())).toEqual(
      attempted,
    );
    await store.recordConfirmed(original.mutationId, signal());
    const verified = await store.recordVerified(original.mutationId, signal());
    expect(verified).toEqual({ ...original, phase: "verified" });
    expect(await journal().load(signal())).toEqual(verified);
    expect(await journal().prepare(ops, signal())).toEqual(verified);
    expect("remove" in store).toBe(false);
  });
  it("keeps a nonextractable origin key and ciphertext, not plaintext definitions", async () => {
    await journal().prepare(ops, signal());
    const stored = await row();
    const key = stored.key as CryptoKey;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    expect(JSON.stringify(stored)).not.toContain(ops[0].doc);
    expect(stored.ciphertext).toBeInstanceOf(ArrayBuffer);
  });
  it("copies the exact plan before the first await", async () => {
    const mutable = structuredClone(ops);
    const prepare = journal().prepare(mutable, signal());
    (mutable[0] as { doc: string }).doc = "Caller mutation";
    expect((await prepare).ops).toEqual(ops);
  });
  it("does not replace original operations after an attempted/lost reply", async () => {
    const store = journal(),
      original = await store.prepare(ops, signal());
    await store.recordAttempt(original.mutationId, signal());
    await expect(
      journal().prepare(
        [{ ...ops[0], doc: "Different plan" }, ops[1]],
        signal(),
      ),
    ).rejects.toMatchObject({ reason: "binding" });
    expect((await journal().load(signal()))!.mutationId).toBe(
      original.mutationId,
    );
  });
  it("refuses mismatched IDs, skipped phases, regressions and missing recovery", async () => {
    const store = journal();
    await expect(
      store.recordAttempt(scope.collection, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    const original = await store.prepare(ops, signal());
    await expect(
      store.recordAttempt(scope.collection, signal()),
    ).rejects.toMatchObject({ reason: "binding" });
    await expect(
      store.recordConfirmed(original.mutationId, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    await store.recordAttempt(original.mutationId, signal());
    await store.recordConfirmed(original.mutationId, signal());
    await expect(
      store.recordAttempt(original.mutationId, signal()),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
  it("binds ciphertext to the original collection and preserves an unreadable record", async () => {
    await journal().prepare(ops, signal());
    const stored = await row();
    const other = {
      ...scope,
      collection: "44444444-4444-4444-8444-444444444444",
    };
    await replace(stored, namespace(other));
    await expect(journal(other).load(signal())).rejects.toMatchObject({
      reason: "recovery_required",
    });
    await expect(journal(other).prepare(ops, signal())).rejects.toMatchObject({
      reason: "recovery_required",
    });
    expect((await row(namespace(other))).ciphertext).toEqual(stored.ciphertext);
  });
  it.each(["key", "iv", "ciphertext", "revision"])(
    "never regenerates missing or corrupt %s",
    async (field) => {
      await journal().prepare(ops, signal());
      const stored = await row();
      if (field === "revision") stored.revision = 2;
      else delete stored[field];
      await replace(stored);
      await expect(journal().prepare(ops, signal())).rejects.toMatchObject({
        reason: "recovery_required",
      });
      expect(await row()).toEqual(stored);
    },
  );
  it("fences owner replacement, closure and abort without committing new intent", async () => {
    let current = true;
    const store = journal(scope, () => current);
    current = false;
    await expect(store.prepare(ops, signal())).rejects.toMatchObject({
      reason: "fenced",
    });
    current = true;
    await expect(store.load(signal())).rejects.toMatchObject({
      reason: "fenced",
    });
    const closed = journal();
    closed.close();
    await expect(closed.load(signal())).rejects.toMatchObject({
      reason: "fenced",
    });
    const owner = new AbortController();
    owner.abort();
    await expect(journal().prepare(ops, owner.signal)).rejects.toThrow();
    expect(await journal().load(signal())).toBeNull();
  });
  it("one strict CAS wins concurrent prepares; the loser fences instead of minting a replacement", async () => {
    let arrivals = 0;
    let both!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      both = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => {
      if (++arrivals === 2) both();
      await gate;
      return encrypt(...args);
    });
    const left = journal(),
      right = journal();
    const pending = [left.prepare(ops, signal()), right.prepare(ops, signal())];
    await started;
    release();
    const results = await Promise.allSettled(pending);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const index = results.findIndex((result) => result.status === "rejected");
    expect(results[index]).toMatchObject({
      status: "rejected",
      reason: { reason: "outcome_unknown" },
    });
    await expect([left, right][index]!.load(signal())).rejects.toMatchObject({
      reason: "fenced",
    });
    const winner = results.find((result) => result.status === "fulfilled")!;
    expect(await journal().load(signal())).toEqual(
      winner.status === "fulfilled" ? winner.value : undefined,
    );
  });
  it("permits only a bounded pair of create-only safe MD resources", async () => {
    for (const invalid of [
      [ops[0]],
      [ops[0], ops[0]],
      [{ ...ops[0], path: "../secrets.md" }, ops[1]],
      [{ ...ops[0], path: "_schemas/task.json" }, ops[1]],
      [{ ...ops[0], mustNotExist: false }, ops[1]],
      [{ ...ops[0], doc: "x".repeat(512 * 1024) }, ops[1]],
      [{ ...ops[0], baseRevision: "sha256:" + "ab".repeat(32) }, ops[1]],
    ]) {
      expect(() =>
        journal().prepare(invalid as unknown as ModelDefinitionOps, signal()),
      ).toThrow();
    }
    expect(await journal().load(signal())).toBeNull();
  });
});
