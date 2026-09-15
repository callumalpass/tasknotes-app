import type { ConnectProblem, PendingMutation } from "@mdbase-dev/connect";
import { pendingRecoveryError } from "./outcome";
import {
  pendingRecoveryEntry,
  recoverPendingChanges,
  type PendingRecoveryEntry,
} from "./pending-recovery";

function handle(
  requestId: string,
  recover: PendingMutation["recover"],
): PendingMutation {
  return {
    requestId,
    operation: "create",
    fingerprint: "private-fingerprint",
    createdAt: "2026-09-15T00:00:00Z",
    status: "pending",
    recover,
  };
}

it("checks every original handle after a thrown failure and an unknown outcome", async () => {
  const unavailable = vi
    .fn()
    .mockRejectedValue(new Error("private record contents"));
  const unknown = vi.fn().mockResolvedValue({
    ok: false,
    problem: {
      code: "operation_outcome_unknown",
      message: "private message",
      recovery: "resolve_outcome",
    },
  });
  const confirmed = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { valid: false } });
  const handles = [
    handle("first", unavailable),
    handle("second", unknown),
    handle("third", confirmed),
  ];
  const entries: PendingRecoveryEntry[] = [];
  await recoverPendingChanges(handles, { timeoutMs: 60_000 }, (entry) =>
    entries.push(entry),
  );
  expect(entries.map((entry) => entry.status)).toEqual([
    "checking",
    "unresolved",
    "checking",
    "unresolved",
    "checking",
    "confirmed",
  ]);
  for (const recover of [unavailable, unknown, confirmed]) {
    expect(recover).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 60_000 });
  }
  expect(entries[5]?.message).not.toMatch(/applied/);
  expect(JSON.stringify(entries)).not.toMatch(/private/);
  expect(pendingRecoveryEntry(handles[0]!)).not.toHaveProperty("fingerprint");
});

it.each([
  [{ code: "mutation_recovery_expired", recovery: "none" }, "expired"],
  [{ code: "missing_grant_key", recovery: "reauthorize" }, "authorization"],
  [{ code: "reconnect_required", recovery: "reauthorize" }, "authorization"],
  [
    { code: "operation_outcome_unknown", recovery: "resolve_outcome" },
    "unresolved",
  ],
  [{ code: "network_error", recovery: "retry" }, "unavailable"],
] as const)(
  "classifies %j without reporting a mutation as not sent",
  async (problem, status) => {
    const recover = vi.fn().mockResolvedValue({
      ok: false,
      problem: { ...problem, message: "private message" } as ConnectProblem,
    });
    const entries: PendingRecoveryEntry[] = [];
    await recoverPendingChanges([handle("saved", recover)], {}, (entry) =>
      entries.push(entry),
    );
    expect(entries.at(-1)?.status).toBe(status);
    expect(entries.at(-1)?.message).not.toMatch(
      /not sent|not applied|private message/,
    );
  },
);

it("repeated checks reuse the same handle without reconstructing a mutation", async () => {
  const recover = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ok: true, value: {} });
  const handles = [handle("original", recover)];
  const progress = vi.fn();
  await recoverPendingChanges(handles, {}, progress);
  await recoverPendingChanges(handles, {}, progress);
  expect(recover).toHaveBeenCalledTimes(2);
  expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({
    requestId: "original",
    status: "confirmed",
  });
});

it("describes the original mutation as uncertain, not unsent", () => {
  const error = pendingRecoveryError("original", new Error("offline"));
  expect(error.message).toContain("may have been applied");
  expect(error.message).not.toMatch(/not sent|not applied/);
});
