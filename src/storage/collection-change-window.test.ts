import { CollectionChangeWindow } from "./collection-change-window";

beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => vi.useRealTimers());
it("collapses a burst of N changes into one trailing reload", async () => {
  const reload = vi.fn();
  const window = new CollectionChangeWindow(reload);
  for (let i = 0; i < 100; i++) window.changed();
  await vi.advanceTimersByTimeAsync(249);
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(reload).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds notification delay at two seconds during a stream, then emits one final reload", async () => {
  const reload = vi.fn();
  const window = new CollectionChangeWindow(reload);
  for (let i = 0; i < 21; i++) {
    window.changed();
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(reload).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(250);
  expect(reload).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("waits for an actual quiet window, not the maximum UI notification delay", async () => {
  const window = new CollectionChangeWindow(vi.fn());
  const owner = new AbortController();
  window.changed();
  const completed = vi.fn();
  const pending = window.quiet(owner.signal).then(completed);
  for (let i = 0; i < 30; i++) {
    await vi.advanceTimersByTimeAsync(100);
    window.changed();
  }
  expect(completed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  await pending;
  expect(completed).toHaveBeenCalledOnce();
});
it("lets a waiting reader through only after the trailing reload, even when the clock runs ahead of the timer", async () => {
  const order: string[] = [];
  const window = new CollectionChangeWindow(() => order.push("reload"));
  window.changed();
  await vi.advanceTimersByTimeAsync(249);
  // The quiet period has passed by the clock; the trailing timer has not fired yet.
  const now = vi.spyOn(performance, "now").mockReturnValue(250.5);
  expect(window.unsettled).toBe(true);
  const pending = window
    .quiet(new AbortController().signal)
    .then(() => order.push("reader"));
  await Promise.resolve();
  expect(order).toEqual([]);
  now.mockRestore();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(order).toEqual(["reload", "reader"]);
  expect(vi.getTimerCount()).toBe(0);
});
it("releases a waiting reader when the window is cleared, and forgets an aborted one", async () => {
  const window = new CollectionChangeWindow(vi.fn());
  const owner = new AbortController();
  window.changed();
  const reason = new DOMException("Original deadline", "TimeoutError");
  const aborted = expect(window.quiet(owner.signal)).rejects.toBe(reason);
  const released = window.quiet(new AbortController().signal);
  owner.abort(reason);
  await aborted;
  window.clear();
  await released;
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves the original abort/deadline reason and clears its waiter", async () => {
  const window = new CollectionChangeWindow(vi.fn());
  const owner = new AbortController();
  window.changed();
  const pending = window.quiet(owner.signal);
  const reason = new DOMException("Original deadline", "TimeoutError");
  const rejected = expect(pending).rejects.toBe(reason);
  owner.abort(reason);
  await rejected;
  window.clear();
  expect(vi.getTimerCount()).toBe(0);
});
it("retires all scheduled notifications on disposal/suspension", async () => {
  const reload = vi.fn();
  const window = new CollectionChangeWindow(reload);
  window.changed();
  window.clear();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(reload).not.toHaveBeenCalled();
  await window.quiet(new AbortController().signal);
  expect(vi.getTimerCount()).toBe(0);
});
