import {
  connectError,
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnection,
} from "@mdbase-dev/connect";
import { expect, it, vi } from "vitest";

import { runMdbaseMutation } from "./mdbase-mutation-coordinator";

it("serializes every mutation sharing an mdbase connection", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const first = deferred<void>();
  const calls: string[] = [];

  const firstResult = runMdbaseMutation(connection, async () => {
    calls.push("first:start");
    await first.promise;
    calls.push("first:end");
    return "first";
  });
  const secondResult = runMdbaseMutation(connection, async () => {
    calls.push("second");
    return "second";
  });

  await vi.waitFor(() => expect(calls).toEqual(["first:start"]));
  first.resolve();

  await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
    "first",
    "second",
  ]);
  expect(calls).toEqual(["first:start", "first:end", "second"]);
});

it("retries the exact operation before allowing the next mutation", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const calls: string[] = [];
  const first = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(unknownOutcome())
    .mockResolvedValueOnce("recovered");

  const firstResult = runMdbaseMutation(connection, async () => {
    calls.push("first");
    return first();
  });
  const secondResult = runMdbaseMutation(connection, async () => {
    calls.push("second");
    return "second";
  });

  await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
    "recovered",
    "second",
  ]);
  expect(first).toHaveBeenCalledTimes(2);
  expect(calls).toEqual(["first", "first", "second"]);
});

it("keeps later mutations paused until a previously unknown write recovers", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const calls: string[] = [];
  const first = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(unknownOutcome())
    .mockRejectedValueOnce(unknownOutcome())
    .mockResolvedValueOnce("recovered");

  await expect(
    runMdbaseMutation(connection, async () => {
      calls.push("first");
      return first();
    }),
  ).rejects.toMatchObject({ code: "operation_outcome_unknown" });

  await expect(
    runMdbaseMutation(connection, async () => {
      calls.push("second");
      return "second";
    }),
  ).resolves.toBe("second");

  expect(first).toHaveBeenCalledTimes(3);
  expect(calls).toEqual(["first", "first", "first", "second"]);
});

it("does not send a later mutation when recovery remains uncertain", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const first = vi.fn(async () => {
    throw unknownOutcome();
  });
  const second = vi.fn(async () => "second");

  await expect(runMdbaseMutation(connection, first)).rejects.toMatchObject({
    code: "operation_outcome_unknown",
  });
  await expect(runMdbaseMutation(connection, second)).rejects.toMatchObject({
    code: "operation_outcome_unknown",
    message: expect.stringContaining("earlier change"),
  });

  expect(first).toHaveBeenCalledTimes(3);
  expect(second).not.toHaveBeenCalled();
});

it("unblocks later writes after an exact retry has a definitive failure", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const first = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(unknownOutcome())
    .mockRejectedValueOnce(unknownOutcome())
    .mockRejectedValueOnce(new Error("Write rejected"));
  const blocked = vi.fn(async () => "blocked");
  const later = vi.fn(async () => "later");

  await expect(runMdbaseMutation(connection, first)).rejects.toMatchObject({
    code: "operation_outcome_unknown",
  });
  await expect(runMdbaseMutation(connection, blocked)).rejects.toThrow(
    "Write rejected",
  );
  await expect(runMdbaseMutation(connection, later)).resolves.toBe("later");

  expect(blocked).not.toHaveBeenCalled();
  expect(later).toHaveBeenCalledOnce();
});

it("does not retry a different write rejected by the SDK pending guard", async () => {
  const connection = {} as MdbaseConnection<JsonObject>;
  const operation = vi.fn(async () => {
    throw connectError(
      "pending_mutation_unresolved",
      "Retry the same write first.",
    );
  });

  await expect(runMdbaseMutation(connection, operation)).rejects.toMatchObject({
    code: "pending_mutation_unresolved",
  });
  expect(operation).toHaveBeenCalledOnce();
});

function unknownOutcome(): MdbaseConnectError {
  return connectError(
    "operation_outcome_unknown",
    "The direct write may have completed.",
    { operationOutcome: "unknown" },
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
