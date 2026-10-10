import { connect, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextMutations } from "./next-mutations";

const clients: MdbaseClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.restoreAllMocks();
});
async function fixture() {
  const replica = new MemoryReplica({ confirmDelayMs: null });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "local-mutation-order-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const changed = vi.fn();
  return {
    replica,
    client,
    changed,
    mutations: new NextMutations(client, changed),
    signal: new AbortController().signal,
  };
}

describe("native local-result orchestration (protocol stand-in, not native qualification)", () => {
  it("returns API records before confirmation and captures an independent write", async () => {
    const f = await fixture();
    const finalReads = vi.fn(async () => undefined);
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
          confirmed: async (receipt, signal) => {
            await finalReads();
            return local(receipt, signal);
          },
        },
        f.signal,
      );
    };
    const first = await capture("first.md");
    const second = await capture("second.md");
    expect(first.body).toBe("native API bytes");
    expect(second.id).not.toBe(first.id);
    expect(await f.client.pendingWrites()).toHaveLength(2);
    expect(f.mutations.recordWriteState(first.id)?.state).toBe("pending");
    expect(f.mutations.recordWriteState(second.id)?.state).toBe("pending");
    expect(finalReads).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await vi.waitFor(() => expect(finalReads).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(f.mutations.recordWriteState(first.id)).toBeUndefined();
      expect(f.mutations.recordWriteState(second.id)).toBeUndefined();
    });
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
    expect(f.mutations.recordWriteState(recordId)).toEqual({
      mutationId: mid,
      state: "rejected",
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("uses a current-metadata ACK reader only after local delivery, retaining the original result reader for recovery", async () => {
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

  it("retains the original local reader and ID after a lost response, without reissue", async () => {
    const f = await fixture();
    const recordId = crypto.randomUUID();
    const originalRead = vi.fn((_receipt: wire.Receipt, signal: AbortSignal) =>
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
          local: originalRead,
          confirmed: originalRead,
        },
        f.signal,
      ),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    expect(f.mutations.recordWriteState(recordId)).toEqual({
      mutationId: originalMutation,
      state: "unknown",
    });
    const replacement = vi.fn();
    const replacedReader = vi.fn();
    await expect(
      f.mutations.run(
        {
          key: "different original intent",
          requestId: originalMutation,
          prepare: replacement,
          local: replacedReader,
          confirmed: replacedReader,
        },
        f.signal,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "original_mutation_mismatch",
    });
    expect(replacedReader).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    const record = await f.mutations.run(
      {
        key: "original",
        requestId: originalMutation,
        prepare: replacement,
        local: replacedReader,
        confirmed: replacedReader,
      },
      f.signal,
    );
    expect(record).toMatchObject({
      id: recordId,
      path: "original.md",
      body: "original bytes",
    });
    expect(originalRead).toHaveBeenCalledOnce();
    expect(replacedReader).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(await f.client.pendingWrites()).toHaveLength(1);
  });

  it("an older ACK rereads current bytes and cannot relabel a newer pending edit", async () => {
    const f = await fixture();
    const nativeId = crypto.randomUUID();
    const read = vi.fn((_receipt: wire.Receipt, signal: AbortSignal) =>
      f.client.get(nativeId, { body: true }, signal),
    );
    const first = await f.mutations.runRecord(
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
    expect(first.body).toBe("first");
    expect(second.body).toBe("newer");
    const newest = f.mutations.recordWriteState(nativeId)!;
    const submits = vi.spyOn(f.client, "submit");
    // Step this explicit protocol stand-in only. MemoryReplica does not model
    // overlapping-layer record states; this qualifies queue ordering, not Core.
    f.replica["confirmNext"]();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect((await read.mock.results[2]!.value).body).toBe("newer");
    expect(f.mutations.recordWriteState(nativeId)).toEqual(newest);
    expect(newest.state).toBe("pending");
    expect(submits).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await vi.waitFor(() =>
      expect(f.mutations.recordWriteState(nativeId)).toBeUndefined(),
    );
    expect((await read.mock.results[3]!.value).body).toBe("newer");
    expect(submits).not.toHaveBeenCalled();
  });

  it("restores the native pending metadata after reopening and reads the current layer on confirmation without submitting", async () => {
    const f = await fixture();
    const recordId = crypto.randomUUID();
    const write = await f.client.create(
      { id: recordId, path: "restored.md", body: "durable native intent" },
      { wait: "pending" },
    );
    const submit = vi.spyOn(f.client, "submit");
    const read = vi.fn(async (ids: readonly string[], signal: AbortSignal) => {
      expect(ids).toEqual([recordId]);
      const current = await f.client.get(recordId, { body: true }, signal);
      expect(current.body).toBe("durable native intent");
      expect(current.state.state).toBe("confirmed");
    });
    const reopened = new NextMutations(f.client, vi.fn(), read);
    await reopened.restorePending(f.signal);
    expect(reopened.recordWriteState(recordId)).toEqual({
      mutationId: write.mutationId,
      state: "pending",
    });
    expect(read).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await reopened.restorePending(f.signal);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(reopened.recordWriteState(recordId)).toBeUndefined(),
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
