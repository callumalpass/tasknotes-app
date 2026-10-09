import { connect, MdbaseError, toValue, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelSetupError,
  TaskNotesModelRequiredError,
  type ModelDefinitionOps,
  type ModelSetupIntent,
  type ModelSetupJournal,
  type ModelSetupScope,
} from "../application/ports/model-setup";
import { NativeModelSetup } from "./next-model-setup";
import { nativeModelDefinitionPlan } from "./next-model-plan";
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
  async prepare(ops: ModelDefinitionOps, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.value) {
      this.prepares++;
      this.value = Object.freeze({
        version: 1,
        scope: this.scope,
        mutationId: crypto.randomUUID(),
        ops,
        phase: "prepared",
      });
    }
    return this.value;
  }
  private record(
    id: string,
    phase: ModelSetupIntent["phase"],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (!this.value || this.value.mutationId !== id)
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
});
async function fixture(
  capabilities = ["definitions.manage", "collection.read"],
) {
  const replica = new MemoryReplica({ capabilities });
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
  return { replica, client, journal, owner, scope, setup, verified };
}

describe("original model setup intent and SDK resource operations (stand-ins)", () => {
  it("installs exactly two inline definitions once and verifies original receipt plus complete source readback", async () => {
    const f = await fixture();
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
    expect(submit.mock.calls[0]![0]).toEqual(
      nativeModelDefinitionPlan(new Map()),
    );
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
    const ops = nativeModelDefinitionPlan(new Map());
    for (const op of ops) f.replica.seedResource(op.path, op.doc);
    await f.journal.prepare(ops, f.owner.signal);
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
    await f.journal.prepare(
      nativeModelDefinitionPlan(new Map()),
      f.owner.signal,
    );
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
      "install",
      "resume",
    ]);
    expect(Object.isFrozen(repository.modelSetup)).toBe(true);
    expect(repository.modelSetup).not.toHaveProperty("client");
    expect(repository.modelSetup).not.toHaveProperty("journal");
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
    for (const op of nativeModelDefinitionPlan(new Map()))
      f.replica.seedResource(op.path, op.doc);
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
