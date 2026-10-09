import { IDBFactory } from "fake-indexeddb";
import { collectionJoinIntent } from "./next-collection-join-intent";
const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
describe("original collection join operation (metadata stand-ins)", () => {
  it("commits the first explicit target before bootstrap and thereafter requires existing outcome restore", async () => {
    const signal = new AbortController().signal;
    expect(await collectionJoinIntent(scope, signal, "prepare")).toBe("fresh");
    expect(await collectionJoinIntent(scope, signal, "prepare")).toBe(
      "existing",
    );
    expect(await collectionJoinIntent(scope, signal, "complete")).toBe(
      "existing",
    );
    expect(await collectionJoinIntent(scope, signal, "prepare")).toBe(
      "existing",
    );
  });
  it("never adopts missing original state as completion", async () => {
    await expect(
      collectionJoinIntent(scope, new AbortController().signal, "complete"),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
  it("separates approved target identities without borrowing another collection outcome", async () => {
    const signal = new AbortController().signal;
    expect(await collectionJoinIntent(scope, signal, "prepare")).toBe("fresh");
    expect(
      await collectionJoinIntent(
        { ...scope, collection: scope.account },
        signal,
        "prepare",
      ),
    ).toBe("fresh");
    expect(await collectionJoinIntent(scope, signal, "prepare")).toBe(
      "existing",
    );
  });
  it("refuses a nil target or aborted owner before allocating a join", async () => {
    const owner = new AbortController();
    owner.abort();
    await expect(
      collectionJoinIntent(scope, owner.signal, "prepare"),
    ).rejects.toThrow();
    await expect(
      collectionJoinIntent(
        { ...scope, collection: "00000000-0000-0000-0000-000000000000" },
        new AbortController().signal,
        "prepare",
      ),
    ).rejects.toMatchObject({ reason: "recovery_required" });
  });
});
