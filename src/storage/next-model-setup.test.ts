import { connect, MdbaseError, toValue, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "mdbase";
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
  vi.spyOn(client, "describe").mockImplementation(async (input) => {
    const signal = input && "aborted" in input ? input : input?.signal;
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

describe("original model setup intent and SDK resource operations (stand-ins)", () => {
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
});
