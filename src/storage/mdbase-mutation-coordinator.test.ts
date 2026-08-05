import {
  type ConnectOutcome,
  type JsonObject,
  type MdbaseConnection,
  type PendingMutation,
} from "@mdbase-dev/connect";
import {
  connectError,
  connectFailure,
  connectSuccess,
} from "@mdbase-dev/connect-testing";
import { expect, it, vi } from "vitest";

import {
  reconcileMdbaseMutations,
  runMdbaseMutation,
} from "./mdbase-mutation-coordinator";

it("serializes every mutation sharing an mdbase connection", async () => {
  const connection = pendingConnection();
  const first = deferred<void>();
  const calls: string[] = [];

  const firstResult = runMdbaseMutation(
    connection,
    async () => {
      calls.push("first:start");
      await first.promise;
      calls.push("first:end");
      return "first";
    },
    identityRecovery("first"),
  );
  const secondResult = runMdbaseMutation(
    connection,
    async () => {
      calls.push("second");
      return "second";
    },
    identityRecovery("second"),
  );

  await vi.waitFor(() => expect(calls).toEqual(["first:start"]));
  first.resolve();

  await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
    "first",
    "second",
  ]);
  expect(calls).toEqual(["first:start", "first:end", "second"]);
});

it("recovers the original authority request instead of calling the operation twice", async () => {
  const pending = scriptedPending("request-1", [connectSuccess("recovered")]);
  const connection = pendingConnection(pending);
  const operation = vi.fn(async () => {
    pending.activate();
    throw unknownOutcome("request-1");
  });

  await expect(
    runMdbaseMutation(connection, operation, identityRecovery("create-task")),
  ).resolves.toBe("recovered");

  expect(operation).toHaveBeenCalledOnce();
  expect(pending.recover).toHaveBeenCalledOnce();
});

it("a retry of the same app intent returns its recovered result without a new write", async () => {
  const pending = scriptedPending("request-2", [
    connectFailure(unknownOutcome("request-2").problem),
    connectSuccess("recovered"),
  ]);
  const connection = pendingConnection(pending);
  const first = vi.fn(async () => {
    pending.activate();
    throw unknownOutcome("request-2");
  });
  const retry = vi.fn(async () => "duplicate");

  await expect(
    runMdbaseMutation(connection, first, identityRecovery("update:task-a")),
  ).rejects.toMatchObject({
    problem: {
      code: "operation_outcome_unknown",
      details: { request_id: "request-2" },
    },
  });
  await expect(
    runMdbaseMutation(connection, retry, identityRecovery("update:task-a")),
  ).resolves.toBe("recovered");

  expect(first).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
  expect(pending.recover).toHaveBeenCalledTimes(2);
});

it("recovers an earlier intent before sending a different queued mutation", async () => {
  const pending = scriptedPending("request-3", [
    connectFailure(unknownOutcome("request-3").problem),
    connectSuccess("first recovered"),
  ]);
  const connection = pendingConnection(pending);
  const first = vi.fn(async () => {
    pending.activate();
    throw unknownOutcome("request-3");
  });
  const second = vi.fn(async () => "second");

  await expect(
    runMdbaseMutation(connection, first, identityRecovery("first")),
  ).rejects.toMatchObject({
    problem: { code: "operation_outcome_unknown" },
  });
  await expect(
    runMdbaseMutation(connection, second, identityRecovery("second")),
  ).resolves.toBe("second");

  expect(pending.recover).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledOnce();
});

it("reconciles durable SDK requests after restart before canonical reads", async () => {
  const pending = scriptedPending("restart-request", [
    connectSuccess({
      path: "tasks/recovered.md",
    }),
  ]);
  pending.activate();
  const connection = pendingConnection(pending);

  await expect(reconcileMdbaseMutations(connection)).resolves.toBeUndefined();

  expect(pending.recover).toHaveBeenCalledOnce();
});

it("uses a persisted app-command request mapping to resume an exact deletion", async () => {
  const pending = scriptedPending("delete-request", [
    connectSuccess({
      deleted: true,
    }),
  ]);
  pending.activate();
  const connection = pendingConnection(pending);
  const operation = vi.fn(async () => "duplicate delete");

  await expect(
    runMdbaseMutation(connection, operation, {
      key: "delete:task-a",
      requestId: "delete-request",
      mapRecovered: () => "deleted",
    }),
  ).resolves.toBe("deleted");

  expect(operation).not.toHaveBeenCalled();
  expect(pending.recover).toHaveBeenCalledOnce();
});

it("does not send a later mutation while receipt recovery remains uncertain", async () => {
  const pending = scriptedPending("request-4", [
    connectFailure(unknownOutcome("request-4").problem),
    connectFailure(unknownOutcome("request-4").problem),
  ]);
  const connection = pendingConnection(pending);
  const first = vi.fn(async () => {
    pending.activate();
    throw unknownOutcome("request-4");
  });
  const second = vi.fn(async () => "second");

  await expect(
    runMdbaseMutation(connection, first, identityRecovery("first")),
  ).rejects.toMatchObject({
    problem: { code: "operation_outcome_unknown" },
  });
  await expect(
    runMdbaseMutation(connection, second, identityRecovery("second")),
  ).rejects.toMatchObject({
    code: "operation_outcome_unknown",
    message: expect.stringContaining("earlier change"),
  });

  expect(second).not.toHaveBeenCalled();
});

function identityRecovery(key: string) {
  return { key, mapRecovered: (value: string) => value };
}

interface ScriptedPending extends PendingMutation<unknown> {
  activate(): void;
  isActive(): boolean;
}

function pendingConnection(
  ...pending: ScriptedPending[]
): MdbaseConnection<JsonObject> {
  const byId = new Map(pending.map((entry) => [entry.requestId, entry]));
  return {
    pendingMutation: (requestId: string) => {
      const entry = byId.get(requestId);
      return entry?.isActive() ? entry : null;
    },
    pendingMutations: () =>
      [...byId.values()].filter((entry) => entry.isActive()),
  } as unknown as MdbaseConnection<JsonObject>;
}

function scriptedPending(
  requestId: string,
  outcomes: ConnectOutcome<unknown>[],
): ScriptedPending {
  let active = false;
  const recover = vi.fn(async () => {
    const outcome = outcomes.shift();
    if (!outcome) throw new Error("No scripted recovery outcome remains.");
    if (outcome.ok || outcome.problem.operation_outcome !== "unknown")
      active = false;
    return outcome;
  });
  return {
    activate: () => {
      active = true;
    },
    isActive: () => active,
    requestId,
    operation: "update",
    fingerprint: `fingerprint:${requestId}`,
    status: "outcome_unknown",
    createdAt: "2026-08-05T00:00:00.000Z",
    recover,
  };
}

function unknownOutcome(requestId: string) {
  return connectError(
    "operation_outcome_unknown",
    "The direct write may have completed.",
    {
      operationOutcome: "unknown",
      details: { request_id: requestId },
    },
  );
}

function deferred<Result>() {
  let resolve!: (value: Result | PromiseLike<Result>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Result>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
