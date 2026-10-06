import { appTimers } from "@mdbase-dev/connect/timers";
import {
  TimersApi,
  uuidv7,
  type AppTimersPort,
  type TimerOperationIdentity,
} from "@mdbase-dev/sdk";
import { describe, expect, it, vi } from "vitest";

function fixture() {
  const namespace = "tasknotes";
  const port = {
    list: vi.fn(async () => ({ namespace, timers: [] })),
    put: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    reconcile: vi.fn(async () => ({})),
    reconcileWithReceipt: vi.fn(async () => ({})),
    lookupOperation: vi.fn(async () => ({})),
    registerWebPush: vi.fn(async () => ({
      channelId: "synthetic",
      installationId: "synthetic",
      criteria: [],
    })),
    unregisterWebPush: vi.fn(async () => {}),
    registerFcm: vi.fn(async () => ({
      channelId: "synthetic",
      installationId: "synthetic",
      criteria: [],
      transport: "fcm" as const,
    })),
    unregisterFcm: vi.fn(async () => {}),
    close: vi.fn(),
  } satisfies AppTimersPort;
  const identity: TimerOperationIdentity = {
    namespace,
    operationId: uuidv7(),
    expectedRevision: 7,
  };
  const receipt = {
    protocol_version: 1,
    namespace,
    operation_id: identity.operationId,
    expected_revision: 7,
    committed_revision: 8,
    result: { namespace, timers: [], cancelled_ids: [] },
  };
  return { port, api: new TimersApi(port), identity, receipt };
}

describe("packed timer recovery API intake (synthetic port, not receiver/PG/provider qualification)", () => {
  it("accepts the actual optional Connect factory as the SDK's narrow retained port", () => {
    const factory: (
      connection: Parameters<typeof appTimers>[0],
    ) => AppTimersPort = appTimers;
    expect(factory).toBe(appTimers);
  });

  it("preserves an absent intent revision without inferring zero", async () => {
    const { api } = fixture();
    const result = await api.list("tasknotes");
    expect(result).not.toHaveProperty("intentRevision");
  });

  it("recovers an uncertain original operation by lookup only", async () => {
    const { api, port, identity, receipt } = fixture();
    port.reconcileWithReceipt.mockRejectedValue({
      problem: { operation_outcome: "unknown" },
    });
    await expect(
      api.reconcileWithReceipt({
        ...identity,
        criterionId: "task-reminder",
        timers: [],
      }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    port.lookupOperation.mockResolvedValue({ outcome: "committed", receipt });
    const result = await api.lookupOperation(identity);
    expect(result).toMatchObject({
      outcome: "committed",
      receipt: { ...identity, committedRevision: 8 },
    });
    expect(port.reconcileWithReceipt).toHaveBeenCalledOnce();
    expect(port.lookupOperation).toHaveBeenCalledWith(
      identity.namespace,
      identity.operationId,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(port.reconcile).not.toHaveBeenCalled();
  });

  it("fences a receipt for another operation or revision as original unknown", async () => {
    const { api, port, identity, receipt } = fixture();
    port.lookupOperation
      .mockResolvedValueOnce({
        outcome: "committed",
        receipt: { ...receipt, operation_id: uuidv7() },
      })
      .mockResolvedValueOnce({
        outcome: "committed",
        receipt: { ...receipt, committed_revision: 9 },
      });
    await expect(api.lookupOperation(identity)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    await expect(api.lookupOperation(identity)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(port.reconcileWithReceipt).not.toHaveBeenCalled();
  });

  it("keeps a missing original receipt unknown without replay", async () => {
    const { api, port, identity } = fixture();
    port.lookupOperation.mockResolvedValue({
      outcome: "unknown",
      namespace: identity.namespace,
      operation_id: identity.operationId,
    });
    await expect(api.lookupOperation(identity)).resolves.toEqual({
      outcome: "unknown",
      namespace: identity.namespace,
      operationId: identity.operationId,
    });
    expect(port.reconcileWithReceipt).not.toHaveBeenCalled();
  });

  it("keeps pre-aborted and closed lookups original-unknown with zero port calls", async () => {
    const { api, port, identity } = fixture();
    await expect(
      api.lookupOperation(identity, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    api.close();
    await expect(api.lookupOperation(identity)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(port.lookupOperation).not.toHaveBeenCalled();
    expect(port.reconcileWithReceipt).not.toHaveBeenCalled();
  });
});
