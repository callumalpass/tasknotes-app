import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSetupError } from "../application/ports/model-setup";
import { atomicSetupOperation } from "./next-setup-operation";

const pending = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const owner = new AbortController();
    setTimeout(
      () => owner.abort(new DOMException("signal timed out", "TimeoutError")),
      ms,
    );
    return owner.signal;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bounded explicit atomic setup windows", () => {
  it("slow confirmation outlives the foreground read budget without retrying", async () => {
    const owner = new AbortController(),
      reconcile = vi.fn(),
      progress = vi.fn();
    const work = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 35000));
      signal.throwIfAborted();
    });
    const finished = vi.fn();
    const result = atomicSetupOperation(
      owner.signal,
      work,
      reconcile,
      progress,
    ).then(finished);
    await vi.advanceTimersByTimeAsync(21000);
    expect(finished).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(work.mock.calls[0]![0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(14000);
    await result;
    expect(work).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith("installing");
  });
  it("expires into one new bounded receipt-only window on the SAME original owner", async () => {
    const owner = new AbortController(),
      work = vi.fn(pending),
      progress = vi.fn();
    const reconcile = vi.fn(async (signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
    });
    const result = atomicSetupOperation(
      owner.signal,
      work,
      reconcile,
      progress,
    );
    await vi.advanceTimersByTimeAsync(120000);
    await result;
    expect(work).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(work.mock.calls[0]![0].aborted).toBe(true);
    expect(progress).toHaveBeenLastCalledWith("checking_outcome");
  });
  it("unconfirmed reconciliation stays outcome-unknown without another submit/work", async () => {
    const owner = new AbortController(),
      work = vi.fn(pending),
      reconcile = vi.fn(pending);
    const result = atomicSetupOperation(owner.signal, work, reconcile);
    const refused = expect(result).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    await vi.advanceTimersByTimeAsync(240000);
    await refused;
    expect(work).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });
  it("owner abort or renewal cannot resurrect either window", async () => {
    const owner = new AbortController(),
      work = vi.fn(pending),
      reconcile = vi.fn(pending);
    const result = atomicSetupOperation(owner.signal, work, reconcile);
    const refused = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120000);
    expect(reconcile).toHaveBeenCalledOnce();
    owner.abort(new DOMException("original owner ended", "AbortError"));
    const renewed = new AbortController();
    expect(renewed.signal.aborted).toBe(false);
    await refused;
    expect(reconcile.mock.calls[0]![0].aborted).toBe(true);
  });
  it("bounds adapters that never settle, and ignores their eventual stale reply", async () => {
    const owner = new AbortController(),
      progress = vi.fn();
    let late!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          late = resolve;
        }),
    );
    const reconcile = vi.fn(() => new Promise<void>(() => {}));
    const result = atomicSetupOperation(
      owner.signal,
      work,
      reconcile,
      progress,
    );
    const refused = expect(result).rejects.toMatchObject({
      view: { state: "outcome_unknown" },
    });
    await vi.advanceTimersByTimeAsync(240000);
    await refused;
    late();
    await Promise.resolve();
    expect(work).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith("checking_outcome");
  });
  it("lifecycle cancellation before expiry never enters receipt recovery", async () => {
    const owner = new AbortController(),
      reconcile = vi.fn();
    const work = vi.fn(() => new Promise<void>(() => {}));
    const result = atomicSetupOperation(owner.signal, work, reconcile);
    const refused = expect(result).rejects.toThrow("original owner ended");
    owner.abort(new Error("original owner ended"));
    await refused;
    await vi.advanceTimersByTimeAsync(240000);
    expect(work).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("a typed refusal is not disguised as a timeout or automatically reconciled", async () => {
    const owner = new AbortController(),
      reconcile = vi.fn();
    const refusal = new ModelSetupError({
      state: "blocked",
      message: "original plan refused",
    });
    await expect(
      atomicSetupOperation(
        owner.signal,
        async () => {
          throw refusal;
        },
        reconcile,
      ),
    ).rejects.toBe(refusal);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
