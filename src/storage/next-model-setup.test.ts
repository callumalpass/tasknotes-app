import { connect, MdbaseError, toValue, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "mdbase";
import publisher from "../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.18.json";
import * as modelPlan from "./next-model-plan";
import {
  ModelSetupError,
  TaskNotesModelRequiredError,
  type ModelPackPlan,
  type ModelPackSetupIntent,
  MODEL_SETUP_LIMITS,
  type ModelSetupIntent,
  type ModelSetupJournal,
  type ModelSetupScope,
} from "../application/ports/model-setup";
import { NativeModelSetup } from "./next-model-setup";
import {
  nativeModelPackAssessment,
  nativeModelPackPlan,
} from "./next-model-plan";

// Reuse the pinned package's Node WASM loader; browser asset delivery/custody
// belongs to clients and is not qualified by these application protocol tests.
vi.mock("../cloud/next-model-pack-core", () => ({
  initializeModelPackCore: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await init();
    signal.throwIfAborted();
  },
}));
import { NextTaskRepository } from "./next-repository";

// Protocol replica and synthetic describe only. These tests cover application
// behavior, not native grant/definition enforcement or protected-store custody.
class TestJournal implements ModelSetupJournal {
  value: ModelSetupIntent | null = null;
  prepares = 0;
  events: string[] = [];
  constructor(readonly scope: ModelSetupScope) {}
  async load(signal: AbortSignal) {
    signal.throwIfAborted();
    return this.value;
  }
  async prepare(
    plan: ModelPackPlan,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    signal.throwIfAborted();
    if (!this.value) {
      this.prepares++;
      this.value = Object.freeze({
        version: 2,
        scope: this.scope,
        mutationId: crypto.randomUUID(),
        plan,
        phase: "prepared",
      });
    }
    if (this.value.version !== 2) throw Error("preserve legacy intent");
    return this.value;
  }
  private record(
    id: string,
    phase: ModelSetupIntent["phase"],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (!this.value || this.value.version !== 2 || this.value.mutationId !== id)
      throw Error("wrong original ID");
    this.events.push(phase);
    this.value = Object.freeze({ ...this.value, phase });
    return this.value;
  }
  async recordAttempt(id: string, signal: AbortSignal) {
    return this.record(id, "attempted", signal);
  }
  async recordConfirmed(id: string, signal: AbortSignal) {
    return this.record(id, "confirmed", signal);
  }
  async recordVerified(id: string, signal: AbortSignal) {
    return this.record(id, "verified", signal);
  }
}
const closes: (() => void)[] = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture(
  capabilities = ["definitions.manage", "collection.read"],
) {
  const replica = new MemoryReplica({ capabilities });
  replica.seedResource("mdbase.yaml", 'spec_version: "0.3.0"\n');
  const client = await connect({
    connector: replica.connector(),
    app: { name: "model-test", version: "test" },
    reconnect: false,
  });
  closes.push(() => client.close());
  const scope = Object.freeze({
    account: crypto.randomUUID(),
    installation: crypto.randomUUID(),
    collection: client.hello.collection,
  });
  const journal = new TestJournal(scope);
  const owner = new AbortController();
  vi.spyOn(client, "describe").mockImplementation(async (signal) => {
    const sources = await client.resources.list({ text: true, signal });
    const contract = sources.resources.find(
      (r) => r.path === "_contracts/tasknotes.task.md",
    );
    const type = sources.resources.find((r) => r.path === "_types/task.md");
    const definition = type?.text
      ? parseFrontmatter(type.text).frontmatter
      : undefined;
    const implementations = definition?.implements as
      | {
          contract: string;
          version: string;
          fields: Record<string, string>;
          binding: Record<string, unknown>;
        }[]
      | undefined;
    const catalog: wire.DescribeResult = {
      specVersion: "0.3.0",
      inclusion: { include: [] },
      issues: [],
      settings: new Map(),
      contracts: contract
        ? [
            {
              id: "tasknotes.task",
              version: "0.3.0-rc.5",
              digest: TASKNOTES_CONTRACT_DIGEST,
              path: contract.path,
              contractType: "record",
              implementedBy: type ? ["task"] : [],
            },
          ]
        : [],
      types: type
        ? [
            {
              name: "task",
              path: type.path,
              implements: (implementations ?? []).map((i) => ({
                contract: i.contract,
                version: i.version,
                fields: new Map(Object.entries(i.fields)),
                binding: toValue(i.binding as never),
              })),
            },
          ]
        : [],
    };
    return catalog;
  });
  const verified = vi.fn(async () => undefined);
  const setup = new NativeModelSetup(
    client,
    journal,
    () => owner.signal,
    verified,
  );
  const plan = async () => {
    const listed = await client.resources.list({ text: true });
    const resources = Object.fromEntries(
      listed.resources.map((resource) => [resource.path, resource.text!]),
    );
    const assessment = await nativeModelPackAssessment(resources, owner.signal);
    return nativeModelPackPlan(
      resources,
      assessment.assessment_digest,
      owner.signal,
    );
  };
  return { replica, client, journal, owner, scope, setup, verified, plan };
}

// Page protocol stand-in over the real SDK/MemoryReplica. No native cursor or
// authorization witness: native qualification remains the scoped LAB run.
function paginateModelInventory(f: Awaited<ReturnType<typeof fixture>>) {
  const original = f.client.resources.list.bind(f.client.resources);
  const tails = new Map<string, wire.ResourceView[]>();
  let sequence = 0;
  return vi
    .spyOn(f.client.resources, "list")
    .mockImplementation(async (options) => {
      if (!options?.limit) return original(options);
      const all = options.cursor
        ? tails.get(options.cursor)
        : (await original({ text: true, signal: options.signal })).resources;
      if (!all) throw Error("unknown stand-in cursor");
      const resources = all.slice(0, 2);
      const remaining = all.slice(2);
      if (!remaining.length) return { resources, complete: true };
      const cursor = `snapshot-page-${sequence++}`;
      tails.set(cursor, remaining);
      return { resources, complete: false, cursor };
    });
}

describe("original model setup intent and SDK resource operations (stand-ins)", () => {
  function setupClock() {
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
  it("pins an explicit legacy action before the queue yields, refusing owner renewal without reads or writes", async () => {
    const f = await fixture();
    let current = f.owner;
    const ownerSignal = vi.fn(() => current.signal),
      setup = new NativeModelSetup(
        f.client,
        f.journal,
        ownerSignal,
        f.verified,
      );
    const load = vi.spyOn(f.journal, "load"),
      submit = vi.spyOn(f.client, "submit"),
      uuid = vi.spyOn(crypto, "randomUUID");
    const result = setup.install(),
      stopped = expect(result).rejects.toThrow();
    f.owner.abort();
    current = new AbortController();
    await stopped;
    expect(ownerSignal).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("legacy v2 slow confirmation outlives foreground20s without changing its original submit", async () => {
    const f = await fixture();
    await f.plan();
    setupClock();
    const original = f.client.submit.bind(f.client);
    let markSubmitted!: () => void;
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    const submit = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        const writes = await original(...args);
        // Confirmation is an explicit stand-in event, not the replica's fake
        // zero-delay timer (which cannot advance while this barrier awaits).
        f.replica.confirmAll();
        const receipt = await writes[0]!.confirmed;
        Object.defineProperty(writes[0]!, "confirmed", {
          value: new Promise<typeof receipt>((resolve) =>
            setTimeout(() => resolve(receipt), 35000),
          ),
        });
        markSubmitted();
        return writes;
      });
    const receipt = vi.spyOn(f.client, "awaitReceipt"),
      progress = vi.fn(),
      done = vi.fn();
    const result = f.setup.install(progress).then(done);
    await submitted;
    expect(submit).toHaveBeenCalledOnce();
    const intent = structuredClone(f.journal.value!);
    await vi.advanceTimersByTimeAsync(21000);
    expect(done).not.toHaveBeenCalled();
    expect(f.journal.value?.phase).toBe("attempted");
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(f.journal.value).toMatchObject({ ...intent, phase: "verified" });
    expect(submit).toHaveBeenCalledOnce();
    expect(receipt).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith("waiting_for_confirmation");
    expect(f.verified).toHaveBeenCalledOnce();
  });
  it("legacy v2 deadline recovery awaits the original receipt, never preparing or submitting again", async () => {
    const f = await fixture();
    await f.plan();
    setupClock();
    const original = f.client.submit.bind(f.client);
    let markSubmitted!: () => void;
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    const submit = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        const writes = await original(...args);
        f.replica.confirmAll();
        Object.defineProperty(writes[0]!, "confirmed", {
          value: new Promise<wire.Receipt>(() => {}),
        });
        markSubmitted();
        return writes;
      });
    const receipt = vi.spyOn(f.client, "awaitReceipt"),
      progress = vi.fn();
    const result = f.setup.install(progress);
    await submitted;
    expect(submit).toHaveBeenCalledOnce();
    const intent = structuredClone(f.journal.value!);
    await vi.advanceTimersByTimeAsync(120000);
    await result;
    expect(submit).toHaveBeenCalledOnce();
    expect(f.journal.prepares).toBe(1);
    expect(receipt).toHaveBeenCalledWith(
      intent.mutationId,
      120000,
      expect.any(AbortSignal),
    );
    expect(f.journal.value).toMatchObject({ ...intent, phase: "verified" });
    expect(progress).toHaveBeenLastCalledWith("checking_outcome");
    expect(f.verified).toHaveBeenCalledOnce();
  });
  it("requires the complete published pack/lock before an otherwise valid no-intent model can finalize", async () => {
    const f = await fixture();
    f.replica.seedResource(
      "_contracts/tasknotes.task.md",
      publisher.resources[0]!.document,
    );
    f.replica.seedResource("_types/task.md", publisher.resources[1]!.document);
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toEqual({ state: "required" });
    expect(f.journal.value).toBeNull();
    expect(f.verified).not.toHaveBeenCalled();
    await expect(f.setup.resume()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(submit).not.toHaveBeenCalled();
    await f.setup.install();
    expect(submit).toHaveBeenCalledOnce();
    expect(
      submit.mock.calls[0]![0].map((op) =>
        op.kind === "resource_put" ? op.path : "unexpected",
      ),
    ).toEqual([
      "_schemas/tasknotes/tasknotes-task.schema.json",
      "_schemas/tasknotes/tasknotes-task-binding.schema.json",
      "mdbase.lock.yaml",
    ]);
    expect(f.verified).toHaveBeenCalledOnce();
    if (f.journal.value?.version === 2)
      expect(f.journal.value.plan.readback).toHaveLength(5);
  });
  it("accepts a fully confirmed current pack without manage permission or invented mutation/receipt", async () => {
    const f = await fixture(["read", "write"]);
    const planned = await f.plan();
    for (const op of planned.ops)
      if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
    const submit = vi.spyOn(f.client, "submit"),
      receipt = vi.spyOn(f.client, "awaitReceipt");
    const get = vi.spyOn(f.client.resources, "get");
    expect(await f.setup.inspect()).toEqual({ state: "ready" });
    await f.setup.install();
    await f.setup.resume();
    const operations = [
      ...new Set(get.mock.calls.map(([, signal]) => signal!)),
    ];
    expect(operations).toHaveLength(3); // inspect/install/resume own distinct bounded windows.
    for (const operation of operations) {
      for (const expected of planned.readback)
        expect(get).toHaveBeenCalledWith(expected.path, operation);
      expect(operation.aborted).toBe(false);
    }
    f.owner.abort();
    for (const operation of operations) expect(operation.aborted).toBe(true);
    expect(f.journal.value).toBeNull();
    expect(f.journal.prepares).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
    expect(f.verified).toHaveBeenCalledTimes(2);
  });
  it.each([
    "_schemas/tasknotes/tasknotes-task.schema.json",
    "_schemas/tasknotes/tasknotes-task-binding.schema.json",
    "mdbase.lock.yaml",
  ])(
    "refuses no-intent finalization when %s lacks confirmed source readback",
    async (path) => {
      const f = await fixture();
      for (const op of (await f.plan()).ops)
        if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
      const get = f.client.resources.get.bind(f.client.resources);
      vi.spyOn(f.client.resources, "get").mockImplementation(
        async (...args) => {
          const resource = await get(...args);
          return resource.path === path
            ? { ...resource, state: "pending" }
            : resource;
        },
      );
      const submit = vi.spyOn(f.client, "submit");
      expect(await f.setup.inspect()).toMatchObject({ state: "blocked" });
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "blocked" },
      });
      expect(f.journal.value).toBeNull();
      expect(submit).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it.each(["pending", "not_found"] as const)(
    "does not finalize valid metadata when the actual contract source is %s",
    async (state) => {
      const f = await fixture();
      const planned = await f.plan();
      for (const op of planned.ops)
        if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
      const get = f.client.resources.get.bind(f.client.resources);
      vi.spyOn(f.client.resources, "get").mockImplementation(
        async (...args) => {
          const resource = await get(...args);
          if (resource.path.endsWith("/tasknotes.task.md")) {
            if (state === "not_found")
              throw new MdbaseError({
                code: "not_found",
                recovery: "refresh",
                message: "Contract source is absent or pending deletion",
              });
            return { ...resource, state };
          }
          return resource;
        },
      );
      const submit = vi.spyOn(f.client, "submit");
      expect(await f.setup.inspect()).toMatchObject({ state: "blocked" });
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "blocked" },
      });
      expect(f.journal.value).toBeNull();
      expect(submit).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it.each(["prepared", "attempted", "confirmed", "verified"] as const)(
    "preserves every legacy v1 %s row without reinterpretation or submit",
    async (phase) => {
      const f = await fixture();
      const legacy = Object.freeze({
        version: 1 as const,
        scope: f.scope,
        mutationId: crypto.randomUUID(),
        phase,
        ops: [
          {
            kind: "resource_put" as const,
            path: "_contracts/tasknotes.task.md",
            doc: "Original legacy contract bytes",
            mustNotExist: true as const,
          },
          {
            kind: "resource_put" as const,
            path: "_types/task.md",
            doc: "Original legacy type bytes",
            mustNotExist: true as const,
          },
        ] as const,
      });
      f.journal.value = legacy;
      const submit = vi.spyOn(f.client, "submit"),
        receipt = vi.spyOn(f.client, "awaitReceipt");
      expect(await f.setup.inspect()).toMatchObject({
        state: "blocked",
        message: expect.stringContaining("legacy"),
      });
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "blocked" },
      });
      await expect(f.setup.resume()).rejects.toMatchObject({
        view: { state: "blocked" },
      });
      expect(f.journal.value).toBe(legacy);
      expect(f.journal.prepares).toBe(0);
      expect(f.journal.events).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
      expect(receipt).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it.each(["operations", "readbacks", "utf8-total", "path"] as const)(
    "preserves/refuses an original plan exceeding %s bounds without truncation or replacement",
    async (bound) => {
      const f = await fixture();
      const originalPlan = await f.plan();
      let plan = originalPlan;
      if (bound === "operations")
        plan = {
          ...plan,
          ops: Array.from(
            { length: MODEL_SETUP_LIMITS.operations + 1 },
            () => originalPlan.ops[0]!,
          ),
        };
      if (bound === "readbacks")
        plan = {
          ...plan,
          readback: [
            ...originalPlan.readback,
            ...Array.from(
              {
                length:
                  MODEL_SETUP_LIMITS.readbacks +
                  1 -
                  originalPlan.readback.length,
              },
              (_, i) => ({ path: `retired-${i}`, doc: null }),
            ),
          ],
        };
      if (bound === "utf8-total") {
        const first = originalPlan.ops[0]!;
        if (first.kind !== "resource_put")
          throw Error("fixture requires original core put");
        const doc = "😀".repeat(MODEL_SETUP_LIMITS.plaintextBytes / 6);
        plan = {
          ...plan,
          ops: [{ ...first, doc }, ...originalPlan.ops.slice(1)],
          readback: originalPlan.readback.map((entry) =>
            entry.path === first.path ? { ...entry, doc } : entry,
          ),
        };
      }
      if (bound === "path")
        plan = {
          ...plan,
          readback: [
            ...originalPlan.readback,
            {
              path: "x".repeat(MODEL_SETUP_LIMITS.pathCodeUnits + 1),
              doc: null,
            },
          ],
        };
      const prepared = await f.journal.prepare(plan, f.owner.signal);
      await f.journal.recordAttempt(prepared.mutationId, f.owner.signal);
      const original = f.journal.value;
      const submit = vi.spyOn(f.client, "submit"),
        receipt = vi.spyOn(f.client, "awaitReceipt");
      await expect(f.setup.resume()).rejects.toMatchObject({
        view: { state: "blocked" },
      });
      expect(f.journal.value).toBe(original);
      expect(f.journal.prepares).toBe(1);
      expect(f.journal.events).toEqual(["attempted"]);
      expect(submit).not.toHaveBeenCalled();
      expect(receipt).not.toHaveBeenCalled();
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it("requires explicit re-assessment on snapshot drift before prepare, never an overwrite", async () => {
    const f = await fixture();
    const assess = modelPlan.nativeModelPackAssessment;
    vi.spyOn(modelPlan, "nativeModelPackAssessment").mockImplementationOnce(
      async (...args) => {
        const result = await assess(...args);
        f.replica.seedResource(
          "_types/task.md",
          publisher.resources[1]!.document,
        );
        return result;
      },
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked", message: expect.stringContaining("re-assess") },
    });
    expect(f.journal.value).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect((await f.client.resources.get("_types/task.md")).text).toBe(
      publisher.resources[1]!.document,
    );
  });
  it("holds the original prepared plan if the collection changes before its first submit", async () => {
    const f = await fixture();
    await f.journal.prepare(await f.plan(), f.owner.signal);
    const original = f.journal.value;
    f.replica.seedResource(
      "_contracts/tasknotes.task.md",
      "User-owned conflicting contract bytes",
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.resume()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(f.journal.value).toBe(original);
    expect(f.journal.events).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects dropped or changed original guarded ops returned by the journal", async () => {
    const f = await fixture();
    const attempt = f.journal.recordAttempt.bind(f.journal);
    vi.spyOn(f.journal, "recordAttempt").mockImplementation(async (...args) => {
      const result = await attempt(...args);
      return {
        ...result,
        plan: { ...result.plan, ops: result.plan.ops.slice(1) },
      };
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(submit).not.toHaveBeenCalled();
    expect(f.journal.prepares).toBe(1);
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("checks preserved seed text even when that target is not in the changed ops", async () => {
    const f = await fixture();
    const originalSeed =
      publisher.resources[1]!.document + "\nPreserved user notes.\n";
    f.replica.seedResource("_types/task.md", originalSeed);
    const get = f.client.resources.get.bind(f.client.resources);
    vi.spyOn(f.client.resources, "get").mockImplementation(async (...args) => {
      const resource = await get(...args);
      return f.journal.value?.phase === "confirmed" &&
        resource.path === "_types/task.md"
        ? { ...resource, text: originalSeed + "unexpected change" }
        : resource;
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    expect(
      submit.mock.calls[0]![0].some(
        (op) => op.kind === "resource_put" && op.path === "_types/task.md",
      ),
    ).toBe(false);
    expect(f.journal.value?.version).toBe(2);
    if (f.journal.value?.version === 2)
      expect(f.journal.value.plan.readback).toContainEqual({
        path: "_types/task.md",
        doc: originalSeed,
      });
    expect(f.journal.value?.phase).toBe("confirmed");
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("installs the complete pinned pack plus lock once and verifies original receipt plus complete source readback", async () => {
    const f = await fixture();
    const expected = await f.plan();
    const original = f.client.submit.bind(f.client);
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toEqual({ state: "required" });
    expect(f.journal.value).toBeNull();
    submit.mockImplementation(async (...args) => {
      expect(f.journal.value?.phase).toBe("attempted");
      expect(f.journal.value?.mutationId).toBe(args[1]?.mutationId);
      return original.apply(f.client, args);
    });
    await f.setup.install();
    expect(f.journal.events).toEqual(["attempted", "confirmed", "verified"]);
    expect(f.journal.prepares).toBe(1);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0]).toEqual(expected.ops);
    expect(expected.ops).toHaveLength(5);
    expect(expected.readback).toHaveLength(5);
    expect(expected.ops.at(-1)?.path).toBe("mdbase.lock.yaml");
    expect(submit.mock.calls[0]![1]).not.toHaveProperty("allowPartial");
    expect(f.verified).toHaveBeenCalledOnce();
    expect(await f.setup.inspect()).toEqual({ state: "ready" });
    await f.setup.install();
    await f.setup.resume();
    expect(submit).toHaveBeenCalledOnce();
  });
  it("reconciles a lost submit reply through the same receipt without another submission or ID", async () => {
    const f = await fixture();
    const original = f.client.submit.bind(f.client);
    const submit = vi.spyOn(f.client, "submit");
    submit.mockImplementationOnce(async (...args) => {
      const writes = await original.apply(f.client, args);
      await writes[0]!.confirmed;
      throw Error("reply lost after admission");
    });
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const id = f.journal.value!.mutationId;
    expect(f.journal.value!.phase).toBe("attempted");
    expect(await f.setup.inspect()).toMatchObject({ state: "outcome_unknown" });
    await expect(f.setup.install()).rejects.toBeInstanceOf(ModelSetupError);
    const receipt = vi.spyOn(f.client, "awaitReceipt");
    const reopened = new NativeModelSetup(
      f.client,
      f.journal,
      () => f.owner.signal,
      f.verified,
    );
    await reopened.resume();
    expect(receipt.mock.calls[0]![0]).toBe(id);
    expect(f.journal.value!.mutationId).toBe(id);
    expect(f.journal.prepares).toBe(1);
    expect(submit).toHaveBeenCalledOnce();
    expect(f.journal.value!.phase).toBe("verified");
  });
  it("does not promote matching catalog metadata to confirmation of an unknown original write", async () => {
    const f = await fixture();
    const plan = await f.plan();
    for (const op of plan.ops)
      if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
    await f.journal.prepare(plan, f.owner.signal);
    await f.journal.recordAttempt(f.journal.value!.mutationId, f.owner.signal);
    vi.spyOn(f.client, "awaitReceipt").mockRejectedValue(
      new MdbaseError({
        code: "not_found",
        recovery: "refresh",
        message: "No receipt answer",
      }),
    );
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toMatchObject({ state: "outcome_unknown" });
    await expect(f.setup.resume()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    expect(f.journal.value!.phase).toBe("attempted");
    expect(submit).not.toHaveBeenCalled();
  });
  it("resumes a durably prepared but never attempted intent exactly once", async () => {
    const f = await fixture();
    await f.journal.prepare(await f.plan(), f.owner.signal);
    const id = f.journal.value!.mutationId;
    const submit = vi.spyOn(f.client, "submit");
    await f.setup.resume();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![1]!.mutationId).toBe(id);
    expect(f.journal.value!.mutationId).toBe(id);
  });
  it("requires explicit setup on an existing empty collection and refuses model-less task reads", async () => {
    const f = await fixture();
    const repository = new NextTaskRepository(
      f.client,
      "Existing collection",
      f.scope.account,
      { modelSetupJournal: f.journal },
    );
    const submit = vi.spyOn(f.client, "submit");
    expect(Object.keys(repository.modelSetup!)).toEqual([
      "inspect",
      "onReadinessChange",
      "install",
      "resume",
    ]);
    expect(Object.isFrozen(repository.modelSetup)).toBe(true);
    expect(repository.modelSetup).not.toHaveProperty("client");
    expect(repository.modelSetup).not.toHaveProperty("journal");
    const changed = vi.fn();
    const stop = repository.modelSetup!.onReadinessChange!(changed);
    expect(stop).toBeTypeOf("function");
    expect(changed).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(f.journal.value).toBeNull();
    stop();
    await expect(repository.initialize()).rejects.toBeInstanceOf(
      TaskNotesModelRequiredError,
    );
    expect(submit).not.toHaveBeenCalled();
    expect(f.journal.value).toBeNull();
    await repository.modelSetup!.install();
    await repository.initialize({ deferTaskIndex: true });
    expect(submit).toHaveBeenCalledOnce();
    repository.dispose();
  });
  it("never overwrites a pre-existing partial or conflicting definition", async () => {
    const f = await fixture();
    f.replica.seedResource("_types/task.md", "Existing user bytes");
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toMatchObject({ state: "blocked" });
    await expect(f.setup.install()).rejects.toBeInstanceOf(ModelSetupError);
    expect((await f.client.resources.get("_types/task.md")).text).toBe(
      "Existing user bytes",
    );
    expect(f.journal.value).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not claim an unprovided journal or install definitions just because a repository opens", async () => {
    const f = await fixture();
    const repository = new NextTaskRepository(
      f.client,
      "Existing collection",
      f.scope.account,
    );
    expect(repository.modelSetup).toBeUndefined();
    await expect(repository.initialize()).rejects.toBeInstanceOf(
      TaskNotesModelRequiredError,
    );
    expect(f.journal.value).toBeNull();
    repository.dispose();
  });
  it("does not use a pending type definition as already-valid model readiness", async () => {
    const f = await fixture();
    for (const op of (await f.plan()).ops)
      if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
    const original = f.client.resources.get.bind(f.client.resources);
    vi.spyOn(f.client.resources, "get").mockImplementation(async (...args) => ({
      ...(await original(...args)),
      state: "pending" as const,
    }));
    expect(await f.setup.inspect()).toMatchObject({ state: "blocked" });
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(f.journal.value).toBeNull();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("requires the actual definitions capability before creating any intent", async () => {
    const f = await fixture(["collection.read"]);
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toMatchObject({
      state: "permission_required",
    });
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "permission_required" },
    });
    expect(f.journal.value).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects a journal for a different actual collection before any preparation or write", async () => {
    const f = await fixture();
    const journal = new TestJournal({
      ...f.scope,
      collection: crypto.randomUUID(),
    });
    const setup = new NativeModelSetup(
      f.client,
      journal,
      () => f.owner.signal,
      f.verified,
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(journal.value).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("does not submit when durable attempt recording fails", async () => {
    const f = await fixture();
    vi.spyOn(f.journal, "recordAttempt").mockRejectedValue(
      Error("durable store unavailable"),
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toThrow(
      "durable store unavailable",
    );
    expect(f.journal.value!.phase).toBe("prepared");
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects changed intent identity returned by attempt recording", async () => {
    const f = await fixture();
    const original = f.journal.recordAttempt.bind(f.journal);
    vi.spyOn(f.journal, "recordAttempt").mockImplementation(
      async (...args) => ({
        ...(await original(...args)),
        mutationId: crypto.randomUUID(),
      }),
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(f.journal.prepares).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("installs and reads back the original pack using every inventory page", async () => {
    const f = await fixture();
    const pages = paginateModelInventory(f);
    const submit = vi.spyOn(f.client, "submit");
    await f.setup.install();
    expect(f.journal.value!.phase).toBe("verified");
    expect(f.journal.prepares).toBe(1);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![1]!.mutationId).toBe(
      f.journal.value!.mutationId,
    );
    expect(f.journal.events).toEqual(["attempted", "confirmed", "verified"]);
    expect(f.verified).toHaveBeenCalledOnce();
    expect(
      pages.mock.calls
        .filter(([options]) => options?.limit)
        .every(([options]) => options!.text === true),
    ).toBe(true);
    expect(pages.mock.calls.some(([options]) => options?.cursor)).toBe(true);
    const count = submit.mock.calls.length;
    await f.setup.resume();
    expect(submit.mock.calls).toHaveLength(count);
    expect(f.journal.prepares).toBe(1);
  });
  it("refuses a later pending page before assessment/prepare or any model mutation", async () => {
    const f = await fixture();
    f.replica.seedResource("_schemas/extra.schema.json", '{"type":"string"}');
    f.replica.seedResource("_schemas/last.schema.json", '{"type":"string"}');
    const pages = paginateModelInventory(f);
    const read = pages.getMockImplementation()!;
    pages.mockImplementation(async (options) => {
      const page = await read(options);
      return options?.cursor
        ? {
            ...page,
            resources: page.resources.map((resource) => ({
              ...resource,
              state: "pending" as const,
            })),
          }
        : page;
    });
    const assess = vi.spyOn(modelPlan, "nativeModelPackAssessment");
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "blocked" },
    });
    expect(assess).not.toHaveBeenCalled();
    expect(f.journal.value).toBeNull();
    expect(f.journal.prepares).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  });
  it("retains the original confirmed intent on stale paginated readback, then resumes its receipt only", async () => {
    const f = await fixture();
    const pages = paginateModelInventory(f);
    const read = pages.getMockImplementation()!;
    const submit = vi.spyOn(f.client, "submit");
    const stale = new MdbaseError({
      code: "invalid_request",
      recovery: "fix_request",
      reason: "cursor_stale",
      message: "inventory changed",
    });
    pages.mockImplementation(async (options) => {
      if (options?.cursor && f.journal.value?.phase === "confirmed")
        throw stale;
      return read(options);
    });
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const original = f.journal.value as ModelPackSetupIntent;
    expect(original.phase).toBe("confirmed");
    expect(f.journal.events).toEqual(["attempted", "confirmed"]);
    expect(f.journal.prepares).toBe(1);
    expect(f.verified).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    const awaitReceipt = vi.spyOn(f.client, "awaitReceipt");
    pages.mockImplementation(read);
    await f.setup.resume();
    expect(awaitReceipt.mock.calls[0]![0]).toBe(original.mutationId);
    expect(f.journal.value!.mutationId).toBe(original.mutationId);
    expect((f.journal.value as ModelPackSetupIntent).plan).toEqual(
      original.plan,
    );
    expect(f.journal.value!.phase).toBe("verified");
    expect(f.journal.prepares).toBe(1);
    expect(submit).toHaveBeenCalledOnce();
    expect(f.verified).toHaveBeenCalledOnce();
  });
  it.each(["incomplete", "pending", "cursor_stale"] as const)(
    "reports uncertain rather than blocked for %s inventory when inspecting a verified original intent",
    async (refusal) => {
      const f = await fixture();
      const submit = vi.spyOn(f.client, "submit");
      await f.setup.install();
      const original = structuredClone(f.journal.value);
      expect(original!.phase).toBe("verified");
      f.verified.mockClear();
      const events = [...f.journal.events];
      const read = f.client.resources.list.bind(f.client.resources);
      const list = vi
        .spyOn(f.client.resources, "list")
        .mockImplementation(async (options) => {
          if (refusal === "cursor_stale")
            throw new MdbaseError({
              code: "invalid_request",
              recovery: "fix_request",
              reason: "cursor_stale",
              message: "inventory changed",
            });
          const page = await read(options);
          return refusal === "incomplete"
            ? { ...page, complete: false }
            : {
                ...page,
                resources: page.resources.map((resource) => ({
                  ...resource,
                  state: "pending" as const,
                })),
              };
        });
      await expect(f.setup.inspect()).resolves.toMatchObject({
        state: "outcome_unknown",
      });
      expect(list).toHaveBeenCalledOnce();
      expect(f.journal.value).toEqual(original);
      expect(f.journal.events).toEqual(events);
      expect(f.journal.prepares).toBe(1);
      expect(submit).toHaveBeenCalledOnce();
      expect(f.verified).not.toHaveBeenCalled();
    },
  );
  it("refuses an incomplete confirmed resource list without finalizing", async () => {
    const f = await fixture();
    const original = f.client.resources.list.bind(f.client.resources);
    vi.spyOn(f.client.resources, "list").mockImplementation(
      async (...args) => ({
        ...(await original(...args)),
        complete: f.journal.value?.phase !== "confirmed",
      }),
    );
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    expect(f.journal.value!.phase).toBe("confirmed");
    expect(f.verified).not.toHaveBeenCalled();
  });
  it.each([
    ["list", "_contracts/tasknotes.task.md"],
    ["list", "_types/task.md"],
    ["get", "_contracts/tasknotes.task.md"],
    ["get", "_types/task.md"],
    ["list", "_schemas/tasknotes/tasknotes-task.schema.json"],
    ["get", "_schemas/tasknotes/tasknotes-task.schema.json"],
    ["list", "_schemas/tasknotes/tasknotes-task-binding.schema.json"],
    ["get", "_schemas/tasknotes/tasknotes-task-binding.schema.json"],
    ["list", "mdbase.lock.yaml"],
    ["get", "mdbase.lock.yaml"],
  ] as const)(
    "refuses pending %s readback of %s even with exact text and revision",
    async (method, path) => {
      const f = await fixture();
      const submit = vi.spyOn(f.client, "submit");
      if (method === "list") {
        const original = f.client.resources.list.bind(f.client.resources);
        vi.spyOn(f.client.resources, "list").mockImplementation(
          async (...args) => {
            const result = await original(...args);
            return {
              ...result,
              resources: result.resources.map((resource) =>
                f.journal.value?.phase === "confirmed" && resource.path === path
                  ? { ...resource, state: "pending" as const }
                  : resource,
              ),
            };
          },
        );
      } else {
        const original = f.client.resources.get.bind(f.client.resources);
        vi.spyOn(f.client.resources, "get").mockImplementation(
          async (...args) => {
            const resource = await original(...args);
            return f.journal.value?.phase === "confirmed" &&
              resource.path === path
              ? { ...resource, state: "pending" as const }
              : resource;
          },
        );
      }
      await expect(f.setup.install()).rejects.toMatchObject({
        view: { state: "outcome_unknown" },
      });
      expect(f.journal.value!.phase).toBe("confirmed");
      expect(f.journal.events).toEqual(["attempted", "confirmed"]);
      expect(f.verified).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledOnce();
    },
  );
  it("awaits completion recording and resumes its lost reply with the same original intent", async () => {
    const f = await fixture();
    f.verified.mockRejectedValueOnce(Error("completion reply lost"));
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    const id = f.journal.value!.mutationId;
    expect(f.journal.value!.phase).toBe("verified");
    const receipt = vi.spyOn(f.client, "awaitReceipt");
    await f.setup.resume();
    expect(receipt.mock.calls[0]![0]).toBe(id);
    expect(f.journal.value!.mutationId).toBe(id);
    expect(f.verified).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("finalizes an already-valid model without inventing an intent, also after a lost completion reply", async () => {
    const f = await fixture();
    for (const op of (await f.plan()).ops)
      if (op.kind === "resource_put") f.replica.seedResource(op.path, op.doc);
    const submit = vi.spyOn(f.client, "submit");
    expect(await f.setup.inspect()).toEqual({ state: "ready" });
    expect(f.verified).not.toHaveBeenCalled();
    f.verified.mockRejectedValueOnce(Error("completion reply lost"));
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    await f.setup.resume();
    expect(f.journal.value).toBeNull();
    expect(f.journal.prepares).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(f.verified).toHaveBeenCalledTimes(2);
  });
  it("retains a confirmed intent when complete source confirmation is unavailable", async () => {
    const f = await fixture();
    const original = f.client.resources.get.bind(f.client.resources);
    const get = vi.spyOn(f.client.resources, "get");
    get.mockImplementation(async (...args) => {
      if (f.journal.value?.phase === "confirmed")
        throw Error("readback unavailable");
      return original(...args);
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.setup.install()).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    expect(f.journal.value!.phase).toBe("confirmed");
    get.mockImplementation(original);
    await f.setup.resume();
    expect(submit).toHaveBeenCalledOnce();
    expect(f.journal.value!.phase).toBe("verified");
  });
});
