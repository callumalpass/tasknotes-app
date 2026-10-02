import { expect, it } from "vitest";
import type { ConnectProblemCode } from "@mdbase-dev/connect";
import { connectError, connectFailure } from "@mdbase-dev/connect-testing";
import { connectProblemFromError } from "../cloud/outcome";
import { toOperationalError } from "../application/operational-error";
import { MdbaseTaskRepository } from "./mdbase-repository";
import {
  mdbaseFixture,
  taskRecord,
  unknownOutcome,
} from "../test/mdbase-fixture";

it.each([
  ["connector_offline", "unavailable", true, "unavailable"],
  ["hosted_provider_unavailable", "unavailable", true, "unavailable"],
  ["access_paused", "unavailable", false, "unavailable"],
  ["collection_access_denied", "permission-denied", false, "connected"],
  ["operation_cancelled", "cancelled", false, "connected"],
  ["operation_invalid", "validation", false, "connected"],
  ["operation_outcome_unknown", "outcome-unknown", false, "connected"],
  ["pending_mutation_unresolved", "outcome-unknown", false, "connected"],
] as const)(
  "classifies %s through the real write adapter without relying on error wording",
  async (code, operationalCode, retryable, state) => {
    const f = mdbaseFixture([taskRecord("one", "One", "r1")]);
    const repository = new MdbaseTaskRepository(f.connect);
    await repository.initialize();
    // A neutral message deliberately cannot supply the failure category.
    const problem = connectError(
      code as ConnectProblemCode,
      "Neutral diagnostic",
    ).problem;
    f.create.mockResolvedValueOnce(connectFailure(problem) as never);
    const reason: unknown = await repository
      .create({ title: "New task" })
      .catch((error: unknown) => error);
    expect(connectProblemFromError(reason)).toEqual(problem);
    expect(toOperationalError(reason, "create-task")).toMatchObject({
      code: operationalCode,
      retryable,
    });
    expect(await repository.connectionStatus()).toMatchObject({ state });
    expect(f.create).toHaveBeenCalledOnce();
    repository.dispose();
  },
);

it("keeps an unconfirmed accepted create tied to exact recovery", async () => {
  const f = mdbaseFixture([]);
  const repository = new MdbaseTaskRepository(f.connect);
  await repository.initialize();
  const create = f.create.getMockImplementation()!;
  const problem = unknownOutcome().problem;
  f.create.mockImplementationOnce(async (input) => {
    await create(input);
    f.stagePendingMutation("fixture-request", async () =>
      connectFailure(problem),
    );
    return connectFailure(problem) as never;
  });
  const reason: unknown = await repository
    .create({ title: "Accepted but unconfirmed" })
    .catch((error: unknown) => error);
  const failure = toOperationalError(reason, "create-task");
  expect(failure).toMatchObject({
    code: "outcome-unknown",
    retryable: false,
    problem: {
      operation_outcome: "unknown",
      recovery: "resolve_outcome",
      details: { request_id: "fixture-request" },
    },
  });
  expect(f.records.size).toBe(1);
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.connect.pendingMutation("fixture-request")).toBeDefined();
  repository.dispose();
});

it.each([
  "connector_offline",
  "hosted_provider_unavailable",
  "access_paused",
] as const)(
  "retains cached views while publishing %s availability",
  async (code) => {
    const f = mdbaseFixture([taskRecord("one", "One", "r1")]);
    const repository = new MdbaseTaskRepository(f.connect);
    await repository.initialize();
    const views = await repository.listViews();
    Object.assign(f.connect, {
      listViews: async () =>
        connectFailure(connectError(code, "Neutral diagnostic").problem),
    });
    expect(await repository.listViews()).toEqual(views);
    expect(await repository.connectionStatus()).toMatchObject({
      state: "unavailable",
    });
    repository.dispose();
  },
);

it.each([
  "operation_cancelled",
  "collection_access_denied",
  "operation_invalid",
  "operation_outcome_unknown",
] as const)("does not turn %s during refresh into an outage", async (code) => {
  const f = mdbaseFixture([taskRecord("one", "One", "r1")]);
  const repository = new MdbaseTaskRepository(f.connect);
  await repository.initialize();
  Object.assign(f.connect, {
    describe: async () =>
      connectFailure(
        connectError(code as ConnectProblemCode, "Neutral diagnostic").problem,
      ),
  });
  await repository.refresh();
  expect(await repository.connectionStatus()).toMatchObject({
    state: "connected",
  });
  repository.dispose();
});
