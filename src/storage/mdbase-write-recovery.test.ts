import { connectFailure, connectSuccess } from "@mdbase-dev/connect-testing";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureSession } from "../application/capture-session";
import { recoverPendingChanges } from "../cloud/pending-recovery";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  mdbaseFixture,
  taskRecord,
  unknownOutcome,
} from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { recoverMdbaseMutationHandle } from "./mdbase-mutation-coordinator";

afterEach(() => vi.useRealTimers());

it.each(["retry", "recovery review"])(
  "retries an uncertain accepted capture after %s with the same application intent",
  async (recovery) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const fixture = mdbaseFixture([]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const persist = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementationOnce(async (input) => {
      const accepted = await persist(input);
      let attempt = 0;
      fixture.stagePendingMutation("fixture-request", async () =>
        ++attempt === 1
          ? connectFailure(unknownOutcome().problem)
          : connectSuccess(accepted.result),
      );
      throw unknownOutcome();
    });
    const capture = new CaptureSession();
    capture.editText("One capture");
    const options = {
      configuration: defaultTaskCollectionConfiguration(),
      defaults: {},
      create: repository.create.bind(repository),
    };
    expect(await capture.submit(options)).toBeNull();
    vi.setSystemTime(new Date("2026-10-02T12:00:02Z"));
    expect(capture.getSnapshot().error).toMatchObject({
      code: "outcome-unknown",
      retryable: false,
    });
    capture.editText("Must not become a new create");
    capture.editFields({ status: "done" }, options.configuration);
    expect(capture.getSnapshot().text).toBe("One capture");
    expect(capture.discard()).toBe(false);
    if (recovery === "recovery review")
      await recoverPendingChanges(
        fixture.connect.pendingMutations(),
        {},
        () => {},
        (handle, request) =>
          recoverMdbaseMutationHandle(fixture.connect, handle, request),
      );
    const recovered = await capture.submit(options);
    expect(recovered?.title).toBe("One capture");
    expect(fixture.records.size).toBe(1);
    expect(fixture.create).toHaveBeenCalledOnce();
    // A separate submission of identical text is not the same intent.
    capture.editText("One capture");
    await capture.submit(options);
    expect(fixture.records.size).toBe(2);
  },
);

it("does not adopt an unrelated pending write's receipt as a capture intent", async () => {
  const fixture = mdbaseFixture([taskRecord("existing", "Existing", "r1")]);
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize();
  fixture.update.mockImplementationOnce(async () => {
    fixture.stagePendingMutation("fixture-request", async () =>
      connectFailure(unknownOutcome().problem),
    );
    throw unknownOutcome();
  });
  await expect(
    repository.update("existing", { title: "Unconfirmed update" }),
  ).rejects.toMatchObject({ code: "operation_outcome_unknown" });
  const capture = new CaptureSession();
  capture.editText("New capture");
  const options = {
    configuration: defaultTaskCollectionConfiguration(),
    defaults: {},
    create: repository.create.bind(repository),
  };
  expect(await capture.submit(options)).toBeNull();
  expect(capture.getSnapshot().error?.code).toBe("outcome-unknown");
  expect(capture.canRecover).toBe(false);
  expect(await capture.submit(options)).toBeNull();
  expect(fixture.create).not.toHaveBeenCalled();
});

it("never turns a missing create receipt into a fresh create", async () => {
  const fixture = mdbaseFixture([]);
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize();
  const persist = fixture.create.getMockImplementation()!;
  fixture.create.mockImplementationOnce(async (input) => {
    await persist(input);
    fixture.stagePendingMutation("fixture-request", async () =>
      connectFailure(unknownOutcome().problem),
    );
    throw unknownOutcome();
  });
  const capture = new CaptureSession();
  capture.editText("Only once");
  const options = {
    configuration: defaultTaskCollectionConfiguration(),
    defaults: {},
    create: repository.create.bind(repository),
  };
  await capture.submit(options);
  vi.spyOn(fixture.connect, "pendingMutation").mockReturnValue(null);
  vi.spyOn(fixture.connect, "pendingMutations").mockReturnValue([]);
  expect(await capture.submit(options)).toBeNull();
  expect(await capture.submit(options)).toBeNull();
  expect(capture.getSnapshot().error?.code).toBe("outcome-unknown");
  expect(capture.getSnapshot().text).toBe("Only once");
  expect(fixture.create).toHaveBeenCalledOnce();
  expect(fixture.records.size).toBe(1);
});

it.each(["evicted document", "removed summary", "new repository"])(
  "recovers exact deletion receipts with a %s without reading the deleted file",
  async (state) => {
    const record = taskRecord("delete-me", "Delete me", "r1");
    const others = Array.from({ length: 65 }, (_, i) =>
      taskRecord(`other-${i}`, `Other ${i}`, `other-r${i}`),
    );
    const fixture = mdbaseFixture([record, ...others]);
    let repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const persist = fixture.remove.getMockImplementation()!;
    let recovery: ReturnType<typeof fixture.stagePendingMutation> | undefined;
    fixture.remove.mockImplementationOnce(async (input) => {
      const accepted = await persist(input);
      let attempt = 0;
      recovery = fixture.stagePendingMutation("fixture-request", async () =>
        ++attempt === 1
          ? connectFailure(unknownOutcome().problem)
          : connectSuccess(accepted.result),
      );
      throw unknownOutcome();
    });
    await expect(repository.delete("delete-me")).rejects.toMatchObject({
      code: "operation_outcome_unknown",
    });
    if (state === "evicted document") {
      for (const other of others)
        await repository.get(String(other.frontmatter.id));
    } else if (state === "removed summary") {
      await repository.refresh();
    } else {
      repository = new MdbaseTaskRepository(fixture.connect);
      await repository.initialize();
    }
    fixture.read.mockClear();
    await expect(
      repository.delete("delete-me", {
        authorityRequestId: "fixture-request",
      }),
    ).resolves.toBeUndefined();
    expect(recovery?.recover).toHaveBeenCalledTimes(2);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledOnce();
    expect(await repository.getSummary("delete-me")).toBeNull();
  },
);

it("does not infer exact deletion acceptance from an absent task", async () => {
  const repository = new MdbaseTaskRepository(mdbaseFixture([]).connect);
  await repository.initialize();
  await expect(
    repository.delete("missing", {
      authorityRequestId: "missing-receipt",
    }),
  ).rejects.toThrow();
});

it("creates directly in a completed status", async () => {
  const repository = new MdbaseTaskRepository(mdbaseFixture([]).connect);
  await repository.initialize();
  await expect(
    repository.create({ title: "Already done", status: "done" }),
  ).resolves.toMatchObject({ completed: true });
});
