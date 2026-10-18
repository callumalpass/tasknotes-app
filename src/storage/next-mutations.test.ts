import { connect, type MdbaseClient } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextMutations } from "./next-mutations";

const clients: MdbaseClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.restoreAllMocks();
});

async function fixture(confirmDelayMs: number | null = 0) {
  const replica = new MemoryReplica({ confirmDelayMs });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "next-mutations-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  return {
    replica,
    client,
    mutations: new NextMutations(client),
    signal: new AbortController().signal,
  };
}

function run(
  mutations: NextMutations,
  key: string,
  submit: (
    id: string,
    signal: AbortSignal,
  ) => Promise<import("@mdbase-dev/sdk").Write>,
  signal: AbortSignal,
  requestId?: string,
) {
  return mutations.run(
    {
      key,
      prepare: async (id, scope) => () => submit(id, scope),
      confirmed: async (receipt) => receipt,
      requestId,
    },
    signal,
  );
}

function create(client: MdbaseClient, path: string) {
  return vi.fn((mutationId: string, signal: AbortSignal) =>
    client.create(
      { path, frontmatter: { title: "test" }, body: "accepted bytes" },
      { mutationId, signal },
    ),
  );
}

describe("native mutation identity and receipt boundary (protocol stand-in)", () => {
  it("reports success only after a confirmed receipt", async () => {
    const f = await fixture(null);
    const submit = create(f.client, "test.md");
    let completed = false;
    const result = run(f.mutations, "create:test", submit, f.signal).then(
      (receipt) => {
        completed = true;
        return receipt;
      },
    );
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    expect(completed).toBe(false);
    f.replica.confirmAll();
    expect((await result).state).toBe("confirmed");
  });

  it("recovers a lost submit response without sending a second create or new ID", async () => {
    const f = await fixture();
    const realCreate = create(f.client, "lost-ack.md");
    const lost = vi.fn(async (id: string, signal: AbortSignal) => {
      await realCreate(id, signal);
      throw new Error("Lost response after remote admission");
    });
    await expect(
      run(f.mutations, "create:lost", lost, f.signal),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    const requestId = realCreate.mock.calls[0]![0];
    const retry = create(f.client, "must-not-be-created.md");
    const receipt = await run(f.mutations, "create:lost", retry, f.signal);
    expect(receipt.mutation).toBe(requestId);
    expect(receipt.state).toBe("confirmed");
    expect(retry).not.toHaveBeenCalled();
    expect((await f.client.query({})).records.map((r) => r.path)).toEqual([
      "lost-ack.md",
    ]);
  });

  it("blocks a different action until the original uncertain write is recovered", async () => {
    const f = await fixture();
    const submit = create(f.client, "first.md");
    await expect(
      run(
        f.mutations,
        "first",
        async (id, signal) => {
          await submit(id, signal);
          throw new Error("lost");
        },
        f.signal,
      ),
    ).rejects.toThrow();
    const next = create(f.client, "second.md");
    await expect(
      run(f.mutations, "different", next, f.signal),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "earlier_mutation_pending",
      details: submit.mock.calls[0]![0],
    });
    expect(next).not.toHaveBeenCalled();
    await run(f.mutations, "first", submit, f.signal);
    await run(f.mutations, "different", next, f.signal);
    expect(next).toHaveBeenCalledOnce();
  });

  it("retains an admitted write after lifecycle cancellation and observes it on retry", async () => {
    const f = await fixture(null);
    const controller = new AbortController();
    const submit = create(f.client, "backgrounded.md");
    const result = run(
      f.mutations,
      "backgrounded",
      async (id, signal) => {
        const write = await submit(id, signal);
        controller.abort();
        return write;
      },
      controller.signal,
    );
    await expect(result).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        details: { request_id: expect.any(String) },
      },
    });
    f.replica.confirmAll();
    const retry = create(f.client, "duplicate.md");
    expect(
      (await run(f.mutations, "backgrounded", retry, f.signal)).state,
    ).toBe("confirmed");
    expect(retry).not.toHaveBeenCalled();
  });

  it("an already aborted scope never submits or retains a phantom mutation", async () => {
    const f = await fixture();
    const submit = create(f.client, "aborted.md");
    await expect(
      run(f.mutations, "aborted", submit, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(submit).not.toHaveBeenCalled();
    expect((await run(f.mutations, "fresh", submit, f.signal)).state).toBe(
      "confirmed",
    );
  });

  it("a preparation failure does not retain a phantom mutation", async () => {
    const f = await fixture();
    const submit = create(f.client, "valid.md");
    await expect(
      f.mutations.run(
        {
          key: "bad",
          prepare: async () => {
            throw new Error("Invalid model input");
          },
          confirmed: async (r) => r,
        },
        f.signal,
      ),
    ).rejects.toThrow("Invalid model input");
    expect((await run(f.mutations, "valid", submit, f.signal)).state).toBe(
      "confirmed",
    );
  });

  it("a failed result read retries only the known confirmed receipt", async () => {
    const f = await fixture();
    const submit = create(f.client, "accepted.md");
    const prepared = vi.fn(
      async (id: string, signal: AbortSignal) => () => submit(id, signal),
    );
    const read = vi
      .fn(async (receipt: import("@mdbase-dev/sdk").wire.Receipt) => receipt)
      .mockRejectedValueOnce(new Error("Read unavailable"));
    const operation = { key: "accepted", prepare: prepared, confirmed: read };
    const failure = await f.mutations
      .run(operation, f.signal)
      .catch((reason: unknown) => reason);
    expect(failure).toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        recovery: "resolve_outcome",
        details: { request_id: submit.mock.calls[0]![0] },
      },
      cause: { message: "Read unavailable" },
    });
    expect(read.mock.calls[0]![0].mutation).toBe(submit.mock.calls[0]![0]);
    const replacement = create(f.client, "blocked-after-read-failure.md");
    await expect(
      run(f.mutations, "different", replacement, f.signal),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "earlier_mutation_pending",
      details: submit.mock.calls[0]![0],
    });
    expect(replacement).not.toHaveBeenCalled();
    const receiptLookup = vi.spyOn(f.client, "receipt");
    expect((await f.mutations.run(operation, f.signal)).state).toBe(
      "confirmed",
    );
    expect(prepared).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(receiptLookup).not.toHaveBeenCalled();
    expect(read.mock.calls[0]![0].mutation).toBe(
      read.mock.calls[1]![0].mutation,
    );
  });

  it("cancellation after a confirmed result retains its identity and original reader", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const submit = create(f.client, "confirmed-before-abort.md");
    const original = vi.fn(
      async (receipt: import("@mdbase-dev/sdk").wire.Receipt) => {
        if (!controller.signal.aborted) controller.abort();
        return receipt;
      },
    );
    const operation = {
      key: "confirmed-before-abort",
      prepare: async (id: string, signal: AbortSignal) => () =>
        submit(id, signal),
      confirmed: original,
    };
    const failure = await f.mutations
      .run(operation, controller.signal)
      .catch((reason: unknown) => reason);
    const id = submit.mock.calls[0]![0];
    expect(failure).toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        details: { request_id: id },
      },
      cause: { name: "AbortError" },
    });
    const prepare = vi.fn(operation.prepare);
    const replacementReader = vi.fn(
      async (receipt: import("@mdbase-dev/sdk").wire.Receipt) => receipt,
    );
    const lookup = vi.spyOn(f.client, "receipt");
    expect(
      (
        await f.mutations.run(
          { ...operation, prepare, confirmed: replacementReader },
          f.signal,
        )
      ).mutation,
    ).toBe(id);
    expect(original).toHaveBeenCalledTimes(2);
    expect(prepare).not.toHaveBeenCalled();
    expect(replacementReader).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("retains the original result reader and native target during recovery", async () => {
    const f = await fixture();
    const submit = create(f.client, "original-target.md");
    const original = vi.fn(async () => "original-native-id");
    await expect(
      f.mutations.run(
        {
          key: "same-portable-id",
          prepare: async (id, signal) => async () => {
            await submit(id, signal);
            throw new Error("Lost ACK");
          },
          confirmed: original,
        },
        f.signal,
      ),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    const remapped = vi.fn(async () => "different-native-id");
    const prepare = vi.fn(
      async (id: string, signal: AbortSignal) => () => submit(id, signal),
    );
    expect(
      await f.mutations.run(
        { key: "same-portable-id", prepare, confirmed: remapped },
        f.signal,
      ),
    ).toBe("original-native-id");
    expect(original).toHaveBeenCalledOnce();
    expect(remapped).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("a serialized read-only plan does not create an uncertain mutation", async () => {
    const f = await fixture();
    const confirmed = vi.fn(async () => "must not run");
    expect(
      await f.mutations.run(
        {
          key: "already-converged",
          prepare: async () => ({ value: "already saved" }),
          confirmed,
        },
        f.signal,
      ),
    ).toBe("already saved");
    expect(confirmed).not.toHaveBeenCalled();
    expect(
      (
        await run(
          f.mutations,
          "fresh",
          create(f.client, "after-noop.md"),
          f.signal,
        )
      ).state,
    ).toBe("confirmed");
  });

  it("a mismatched receipt never confirms or clears the original mutation", async () => {
    const f = await fixture();
    const id = crypto.randomUUID();
    const write = await f.client.create(
      { path: "original-receipt.md", body: "" },
      { mutationId: id },
    );
    await write.confirmed;
    vi.spyOn(f.client, "receipt").mockResolvedValueOnce({
      mutation: crypto.randomUUID(),
      state: "confirmed",
    });
    const submit = create(f.client, "not-a-new-write.md");
    await expect(
      run(f.mutations, "recover-original", submit, f.signal, id),
    ).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        details: { request_id: id },
      },
    });
    expect(submit).not.toHaveBeenCalled();
    expect(
      (await run(f.mutations, "recover-original", submit, f.signal, id))
        .mutation,
    ).toBe(id);
    expect(submit).not.toHaveBeenCalled();
  });

  it("persisted request recovery never invokes a new operation", async () => {
    const f = await fixture();
    const id = crypto.randomUUID();
    const write = await f.client.create(
      { path: "persisted.md", body: "" },
      { mutationId: id },
    );
    await write.confirmed;
    const submit = create(f.client, "new.md");
    expect(
      (await run(f.mutations, "persisted", submit, f.signal, id)).mutation,
    ).toBe(id);
    expect(submit).not.toHaveBeenCalled();
  });
});
