import { IDBFactory } from "fake-indexeddb";
import {
  collectionCreateIntent,
  findCollectionCreation,
} from "./next-collection-create-intent";
const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
};
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
// Metadata/transaction stand-ins, not native outcome custody or LAB creation.
describe("bounded collection creation target", () => {
  it("commits one target and preserves it through attempted/completed recovery", async () => {
    const signal = new AbortController().signal;
    const initial = await collectionCreateIntent(scope, signal, "prepare");
    expect(initial.phase).toBe("prepared");
    expect(await collectionCreateIntent(scope, signal, "prepare")).toEqual(
      initial,
    );
    expect(await collectionCreateIntent(scope, signal, "attempt")).toEqual({
      ...initial,
      phase: "attempted",
    });
    await expect(
      collectionCreateIntent(scope, signal, "attempt"),
    ).rejects.toMatchObject({ reason: "outcome_unknown" });
    expect(await collectionCreateIntent(scope, signal, "resume")).toEqual({
      ...initial,
      phase: "attempted",
    });
    expect(await collectionCreateIntent(scope, signal, "complete")).toEqual({
      ...initial,
      phase: "completed",
    });
    expect(await collectionCreateIntent(scope, signal, "resume")).toEqual({
      ...initial,
      phase: "completed",
    });
  });
  it("a later explicit creation replaces only a completed intent with a different durable target", async () => {
    const signal = new AbortController().signal;
    const first = await collectionCreateIntent(scope, signal, "prepare");
    await collectionCreateIntent(scope, signal, "attempt");
    await collectionCreateIntent(scope, signal, "complete");
    const second = await collectionCreateIntent(scope, signal, "prepare");
    expect(second.phase).toBe("prepared");
    expect(second.collection).not.toBe(first.collection);
    expect(
      await findCollectionCreation(scope, first.collection, signal),
    ).toEqual({ ...first, phase: "completed" });
    expect(
      await findCollectionCreation(scope, second.collection, signal),
    ).toEqual(second);
    expect(await collectionCreateIntent(scope, signal, "resume")).toEqual(
      second,
    );
  });
  it("a new create click during an uncertain attempt retains the same target", async () => {
    const signal = new AbortController().signal;
    const first = await collectionCreateIntent(scope, signal, "prepare");
    await collectionCreateIntent(scope, signal, "attempt");
    expect(await collectionCreateIntent(scope, signal, "prepare")).toEqual({
      ...first,
      phase: "attempted",
    });
  });
  it("never treats missing original recovery state as a new creation", async () => {
    const signal = new AbortController().signal;
    await expect(
      collectionCreateIntent(scope, signal, "resume"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    await expect(
      collectionCreateIntent(scope, signal, "complete"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
  it("refuses premature completion and an aborted lifetime", async () => {
    const owner = new AbortController();
    await collectionCreateIntent(scope, owner.signal, "prepare");
    await expect(
      collectionCreateIntent(scope, owner.signal, "complete"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    owner.abort();
    await expect(
      collectionCreateIntent(scope, owner.signal, "prepare"),
    ).rejects.toThrow();
  });
  it("does not adopt corrupt persisted binding or allocate a replacement", async () => {
    const signal = new AbortController().signal;
    const initial = await collectionCreateIntent(scope, signal, "prepare");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("tasknotes.native-collection-create.v1", 1);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("original-creation", "readwrite");
      tx.objectStore("original-creation").put(
        { ...initial, account: initial.installation },
        JSON.stringify([scope.account, scope.installation]),
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await expect(
      collectionCreateIntent(scope, signal, "prepare"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    await expect(
      collectionCreateIntent(scope, signal, "resume"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
});
