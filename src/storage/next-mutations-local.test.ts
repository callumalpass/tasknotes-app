import {
  connect,
  MdbaseError,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextMutations } from "./next-mutations";

const clients: MdbaseClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.restoreAllMocks();
});
async function fixture(
  reconcileWindowMs?: number,
  readDelivered?: (ids: readonly string[]) => Promise<void>,
) {
  const replica = new MemoryReplica({ confirmDelayMs: null });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "local-mutation-order-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  return {
    replica,
    client,
    mutations: new NextMutations(client, readDelivered, reconcileWindowMs),
    signal: new AbortController().signal,
  };
}

describe("native local-result orchestration (protocol stand-in, not native qualification)", () => {
  it("returns API records before confirmation and captures an independent write", async () => {
    const finalReads = vi.fn(async () => undefined);
    const f = await fixture(undefined, finalReads);
    const capture = (path: string) => {
      const recordId = crypto.randomUUID();
      const local = async (_receipt: wire.Receipt, signal: AbortSignal) =>
        f.client.get(recordId, { body: true, document: true }, signal);
      return f.mutations.run(
        {
          key: `create:${path}`,
          recordIds: () => [recordId],
          prepare: async (mutationId, signal) => () =>
            f.client.create(
              {
                id: recordId,
                path,
                frontmatter: { title: path },
                body: "native API bytes",
              },
              {
                mutationId,
                signal,
                wait: "pending",
                include: { body: true, document: true },
              },
            ),
          local,
          confirmed: local,
        },
        f.signal,
      );
    };
    const first = await capture("first.md");
    const second = await capture("second.md");
    expect(first.body).toBe("native API bytes");
    expect(second.id).not.toBe(first.id);
    expect(await f.client.pendingWrites()).toHaveLength(2);
    expect(f.client.ledger.stateOf(first.id)).not.toBe("saved");
    expect(finalReads).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await vi.waitFor(() => expect(finalReads).toHaveBeenCalledTimes(2));
    expect(finalReads).toHaveBeenCalledWith([first.id], expect.anything());
    await vi.waitFor(() =>
      expect(f.client.ledger.getSnapshot().saveState).toBe("saved"),
    );
  });

  it("keeps definitive original rejection when rollback races the local result READ", async () => {
    const f = await fixture();
    const recordId = crypto.randomUUID();
    const submit = vi.spyOn(f.client, "submit");
    let mid = "";
    const read = async (_receipt: wire.Receipt, signal: AbortSignal) => {
      f.replica.reject(mid, {
        code: "conflict",
        recovery: "refresh",
        message: "Rejected at head",
      });
      return f.client.get(recordId, { body: true }, signal);
    };
    await expect(
      f.mutations.runRecord(
        {
          key: "rollback-race",
          recordIds: () => [recordId],
          prepare: async (mutationId, signal) => {
            mid = mutationId;
            return () =>
              f.client.create(
                { id: recordId, path: "rollback.md", body: "native capture" },
                { mutationId, signal, wait: "pending" },
              );
          },
          confirmed: read,
        },
        f.signal,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      mutationId: expect.any(String),
    });
    await vi.waitFor(() =>
      expect(f.client.ledger.stateOf(recordId)).toBe("rejected"),
    );
    expect(f.client.ledger.getSnapshot().rejected[0]?.mutationId).toBe(mid);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("uses a current-metadata ACK reader only after local delivery", async () => {
    const f = await fixture();
    const recordId = crypto.randomUUID();
    const result = vi.fn((_receipt: wire.Receipt, signal: AbortSignal) =>
      f.client.get(recordId, { body: true }, signal),
    );
    const ack = vi.fn(async (_receipt: wire.Receipt, signal: AbortSignal) => {
      await f.client.find(recordId, { body: true }, signal);
    });
    await f.mutations.run(
      {
        key: "current-metadata-ack",
        recordIds: () => [recordId],
        prepare: async (mutationId, signal) => () =>
          f.client.create(
            { id: recordId, path: "metadata.md", body: "original" },
            { mutationId, signal, wait: "pending" },
          ),
        local: result,
        confirmed: result,
        ack,
      },
      f.signal,
    );
    expect(result).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await vi.waitFor(() => expect(ack).toHaveBeenCalledOnce());
    expect(result).toHaveBeenCalledOnce();
  });

  it("a cancelled result READ after capture reconciles itself and returns the original result, never an unknown outcome", async () => {
    const f = await fixture();
    const recordId = crypto.randomUUID();
    const submit = vi.spyOn(f.client, "submit");
    let reads = 0;
    const read = async (_receipt: wire.Receipt, signal: AbortSignal) => {
      // The first READ is cancelled, as when a re-check aborted it.
      if (reads++ === 0)
        throw new MdbaseError({
          code: "cancelled",
          recovery: "retry",
          message: "get cancelled",
        });
      return f.client.get(recordId, { body: true, document: true }, signal);
    };
    const record = await f.mutations.run(
      {
        key: "cancelled read",
        recordIds: () => [recordId],
        prepare: async (mutationId, signal) => () =>
          f.client.create(
            { id: recordId, path: "asdd.md", body: "captured" },
            { mutationId, signal, wait: "pending" },
          ),
        local: read,
        confirmed: read,
      },
      f.signal,
    );
    expect(record).toMatchObject({ id: recordId, body: "captured" });
    expect(submit).toHaveBeenCalledOnce();
    expect(f.client.ledger.stateOf(recordId)).not.toBe("saved");
  });

  it("keeps the original ID after a lost response and recovers it by receipt without reissue", async () => {
    const f = await fixture(50);
    // Receipts are unreadable for the foreground window: the result stays unknown.
    const receipt = vi
      .spyOn(f.client, "receipt")
      .mockRejectedValue(Error("receipt unavailable"));
    const recordId = crypto.randomUUID();
    const read = vi.fn((_receipt: wire.Receipt, signal: AbortSignal) =>
      f.client.get(recordId, { body: true, document: true }, signal),
    );
    let originalMutation = "";
    const submit = vi.fn(async (mutationId: string, signal: AbortSignal) => {
      originalMutation = mutationId;
      await f.client.create(
        { id: recordId, path: "original.md", body: "original bytes" },
        {
          mutationId,
          signal,
          wait: "pending",
          include: { body: true, document: true },
        },
      );
      throw Error("lost response after capture");
    });
    await expect(
      f.mutations.run(
        {
          key: "original",
          recordIds: () => [recordId],
          prepare: async (id, signal) => () => submit(id, signal),
          local: read,
          confirmed: read,
        },
        f.signal,
      ),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    // The SDK ledger keeps the captured write; nobody has to ask for recovery.
    expect(f.client.ledger.stateOf(recordId)).not.toBe("saved");
    receipt.mockRestore();
    const replacement = vi.fn();
    const record = await f.mutations.run(
      {
        key: "original",
        requestId: originalMutation,
        prepare: replacement,
        local: read,
        confirmed: read,
      },
      f.signal,
    );
    expect(record).toMatchObject({
      id: recordId,
      path: "original.md",
      body: "original bytes",
    });
    expect(replacement).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(await f.client.pendingWrites()).toHaveLength(1);
  });

  it("an older confirmation rereads current bytes while a newer edit stays unsaved", async () => {
    const reads: string[] = [];
    const f = await fixture(undefined, async (ids) => {
      for (const id of ids)
        reads.push((await f.client.get(id, { body: true })).body ?? "");
    });
    const nativeId = crypto.randomUUID();
    const read = (_receipt: wire.Receipt, signal: AbortSignal) =>
      f.client.get(nativeId, { body: true }, signal);
    await f.mutations.runRecord(
      {
        key: "create",
        recordIds: () => [nativeId],
        prepare: async (mutationId, signal) => () =>
          f.client.create(
            { id: nativeId, path: "current.md", body: "first" },
            { mutationId, signal, wait: "pending" },
          ),
        confirmed: read,
      },
      f.signal,
    );
    const seen = await f.client.get(nativeId, { body: true });
    const second = await f.mutations.runRecord(
      {
        key: "edit",
        recordIds: () => [nativeId],
        prepare: async (mutationId, signal) => () =>
          f.client.update(
            seen,
            { body: "newer" },
            { mutationId, signal, wait: "pending" },
          ),
        confirmed: read,
      },
      f.signal,
    );
    expect(second.body).toBe("newer");
    const submits = vi.spyOn(f.client, "submit");
    // Step this explicit protocol stand-in only. MemoryReplica does not model
    // overlapping-layer record states; this qualifies queue ordering, not Core.
    f.replica["confirmNext"]();
    await vi.waitFor(() => expect(reads).toEqual(["newer"]));
    expect(f.client.ledger.stateOf(nativeId)).not.toBe("saved");
    f.replica.confirmAll();
    await vi.waitFor(() =>
      expect(f.client.ledger.stateOf(nativeId)).toBe("saved"),
    );
    expect(submits).not.toHaveBeenCalled();
  });
});
