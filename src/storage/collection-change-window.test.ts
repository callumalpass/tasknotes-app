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
