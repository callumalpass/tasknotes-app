import {
  MdbaseError,
  type ChangesWatch,
  type ChangesWatchState,
  type PlainValue,
  type wire,
} from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  return f;
}

// Deliberately retains retired callbacks to exercise the app's own scope fence.
function heldWatch() {
  let state: ChangesWatchState = "starting";
  let error: MdbaseError | null = null;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  void ready.catch(() => {});
  let listener: (
    state: ChangesWatchState,
    error: MdbaseError | null,
  ) => void = () => {};
  const stop = vi.fn(() => {
    state = "closed";
    reject(new DOMException("Watch stopped", "AbortError"));
    listener(state, error);
  });
  const watch: ChangesWatch = Object.assign(stop, {
    ready,
    cursor: undefined,
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    subscribe(fn: typeof listener) {
      listener = fn;
      fn(state, error);
      return () => {};
    },
  });
  // Object.assign evaluates getters, so expose the actual changing state.
  Object.defineProperties(watch, {
    state: { get: () => state },
    error: { get: () => error },
  });
  return {
    watch,
    stop,
    active() {
      state = "active";
      listener(state, null);
      resolve();
    },
    stale(problem: MdbaseError) {
      state = "stale";
      error = problem;
      reject(problem);
      listener(state, error);
    },
    fail(problem: MdbaseError) {
      state = "failed";
      error = problem;
      reject(problem);
      listener(state, error);
    },
  };
}

const unavailable = () =>
  new MdbaseError({
    code: "unavailable",
    recovery: "retry",
    message: "The change feed is unavailable.",
  });
const batch: wire.ChangesResult = {
  changes: [],
  cursor: "test-reset",
  reset: true,
};

async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const task = new TaskNotesTaskModel().create(
    { title: "Before" },
    { id: crypto.randomUUID() },
  );
  const write = await f.client.create({
    type: "task",
    path: task.path,
    frontmatter: task.frontmatter as Record<string, PlainValue>,
    body: task.body,
  });
  await write.confirmed;
  return {
    task,
    record: await f.client.find(
      { path: task.path },
      { include: { body: true, effective: true } },
    ),
  };
}

describe("native change invalidation (SDK stand-in, not Core/Noise/LAB)", () => {
  it("reads after a watch becomes active despite its rejected initial ready", async () => {
    const f = await fixture();
    const first = heldWatch();
    vi.spyOn(f.client, "watchChanges").mockReturnValueOnce(first.watch);
    const opened = f.repository.initialize();
    const problem = unavailable();
    first.stale(problem);
    await expect(opened).rejects.toBe(problem);
    first.active();
    await expect(f.repository.refresh()).resolves.toMatchObject({ scanned: 0 });
    await expect(f.repository.listSummaries()).resolves.toEqual([]);
  });
  it("requires an active watch at page one if the watch went stale during model loading", async () => {
    const f = await fixture();
    const control = heldWatch();
    vi.spyOn(f.client, "watchChanges").mockReturnValueOnce(control.watch);
    const describe = vi.mocked(f.client.describe).getMockImplementation()!;
    const problem = unavailable();
    vi.mocked(f.client.describe).mockImplementationOnce(async (...args) => {
      const result = await describe(...args);
      control.stale(problem);
      return result;
    });
    const pages = vi.spyOn(f.client, "query");
    const opened = f.repository.initialize();
    control.active();
    await expect(opened).rejects.toBe(problem);
    expect(pages).not.toHaveBeenCalled();
    control.active();
    await f.repository.initialize();
    expect(pages).toHaveBeenCalledOnce();
  });

  it("invalidates a loaded index on an actual SDK remote change", async () => {
    const f = await fixture();
    const { task, record } = await seed(f);
    await f.repository.initialize();
    const changed = vi.fn();
    f.repository.subscribe(changed);
    const write = await f.client.update(record!, { patch: { title: "After" } });
    await write.confirmed;
    await vi.waitFor(() =>
      expect(changed).toHaveBeenCalledWith({ kind: "data" }),
    );
    expect(
      (await f.repository.listSummaries()).find((t) => t.id === task.id)?.title,
    ).toBe("After");
  });

  it("recovers source status and invalidates read models when the authenticated watch resumes, without refresh or write replay", async () => {
    const f = await fixture();
    const control = heldWatch();
    vi.spyOn(f.client, "watchChanges").mockReturnValue(control.watch);
    const initialized = f.repository.initialize();
    control.active();
    await initialized;
    const changes = vi.fn();
    f.repository.subscribe(changes);
    control.stale(unavailable());
    expect((await f.repository.connectionStatus()).state).toBe("unavailable");
    changes.mockClear();
    control.active();
    expect((await f.repository.connectionStatus()).state).toBe("connected");
    expect(changes).toHaveBeenCalledWith({ kind: "data" });
    expect(changes).toHaveBeenCalledWith({ kind: "status" });
    // A late callback from this retired scope must never resurrect it.
    f.repository.dispose();
    changes.mockClear();
    control.active();
    expect(changes).not.toHaveBeenCalled();
  });

  it("surfaces startup failure and does not silently restart until explicit refresh", async () => {
    const f = await fixture();
    const first = heldWatch();
    const original = f.client.watchChanges.bind(f.client);
    const watch = vi
      .spyOn(f.client, "watchChanges")
      .mockReturnValueOnce(first.watch)
      .mockImplementation(original);
    const opened = f.repository.initialize();
    const problem = unavailable();
    first.fail(problem);
    await expect(opened).rejects.toBe(problem);
    await expect(f.repository.connectionStatus()).resolves.toMatchObject({
      state: "unavailable",
      message: problem.message,
    });
    await expect(f.repository.initialize()).rejects.toBe(problem);
    expect(watch).toHaveBeenCalledOnce();
    await f.repository.refresh();
    expect(watch).toHaveBeenCalledTimes(2);
    first.stale(problem);
    await expect(f.repository.connectionStatus()).resolves.toMatchObject({
      state: "connected",
    });
  });

  it("discards an invalidated snapshot and its pending metadata, then reads the current layer once", async () => {
    const f = await fixture();
    const task = new TaskNotesTaskModel().create(
      { title: "Retired snapshot" },
      { id: crypto.randomUUID() },
    );
    const write = await f.client.create(
      {
        type: "task",
        path: task.path,
        frontmatter: task.frontmatter as Record<string, PlainValue>,
        body: task.body,
      },
      { wait: "pending" },
    );
    const staleRecord = await f.client.get(write.receipt.records![0]!.id, {
      include: { effective: true },
    });
    expect(staleRecord.state.state).toBe("pending");
    f.replica.confirmAll();
    await f.client.delete(staleRecord);
    const control = heldWatch();
    let changes!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
      changes = callback;
      return control.watch;
    });
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await opened;
    const original = f.client.query.bind(f.client);
    const pages = vi
      .spyOn(f.client, "query")
      .mockImplementationOnce(async () => {
        // The collection moves while this page is in flight.
        changes(batch);
        return { records: [staleRecord], complete: true, asOf: 0 };
      })
      .mockImplementation(original);
    expect(await f.repository.listSummaries()).toEqual([]);
    expect(pages).toHaveBeenCalledTimes(2);
    expect(
      f.repository.writeState({ kind: "task", id: task.id }),
    ).toBeUndefined();
    expect(await f.repository.listSummaries()).toEqual([]);
    expect(pages).toHaveBeenCalledTimes(2);
  });

  it.each(["remote", "local"])(
    "%s data events do not let new reads join an obsolete index snapshot",
    async (kind) => {
      const f = await fixture(),
        control = heldWatch();
      let changes!: (batch: wire.ChangesResult) => void;
      vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
        changes = callback;
        return control.watch;
      });
      const opened = f.repository.initialize({ deferTaskIndex: true });
      control.active();
      await opened;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const originalQuery = f.client.query.bind(f.client);
      const pages = vi
        .spyOn(f.client, "query")
        .mockImplementationOnce(async () => {
          await gate;
          return { records: [], complete: true, asOf: 0 };
        })
        .mockImplementation(originalQuery);
      const expected =
        kind === "local"
          ? [expect.objectContaining({ title: "Accepted local task" })]
          : [];
      const stale = f.repository.listSummaries();
      const refreshed = expect(stale).resolves.toEqual(expected);
      await vi.waitFor(() => expect(pages).toHaveBeenCalledTimes(1));
      if (kind === "remote") changes(batch);
      else await f.repository.create({ title: "Accepted local task" });
      let result: unknown,
        failure: unknown,
        finished = false;
      const current = f.repository.listSummaries().then(
        (value) => {
          result = value;
          finished = true;
        },
        (error) => {
          failure = error;
          finished = true;
          throw error;
        },
      );
      void current.catch(() => {});
      try {
        // A local write is protected by the scan write tracker; both readers may share its page.
        if (kind === "local") release();
        await vi.waitFor(() => expect(finished).toBe(true));
        expect(failure).toBeUndefined();
        expect(result).toEqual(expected);
        expect(pages).toHaveBeenCalledTimes(kind === "local" ? 1 : 2);
      } finally {
        release();
      }
      await refreshed;
      await current;
      expect(await f.repository.listSummaries()).toEqual(expected);
      expect(pages).toHaveBeenCalledTimes(kind === "local" ? 1 : 2);
    },
  );

  it("stops startup on suspend and ignores callbacks from the retired scope after resume", async () => {
    const f = await fixture();
    const old = heldWatch();
    const current = heldWatch();
    let oldCallback!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges")
      .mockImplementationOnce((callback) => {
        oldCallback = callback;
        return old.watch;
      })
      .mockReturnValueOnce(current.watch);
    const opened = f.repository.initialize();
    f.repository.suspend();
    await expect(opened).rejects.toMatchObject({ name: "AbortError" });
    expect(old.stop).toHaveBeenCalledOnce();
    f.repository.resume();
    const resumed = f.repository.initialize({ deferTaskIndex: true });
    current.active();
    await resumed;
    const changed = vi.fn();
    f.repository.subscribe(changed);
    oldCallback(batch);
    old.stale(unavailable());
    expect(changed).not.toHaveBeenCalled();
    await expect(f.repository.connectionStatus()).resolves.toMatchObject({
      state: "connected",
    });
  });

  it("reloads type bindings when a resource change invalidates their catalog", async () => {
    const f = await fixture();
    const control = heldWatch();
    let changes!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
      changes = callback;
      return control.watch;
    });
    const describe = vi.spyOn(f.client, "describe");
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await opened;
    expect(describe).toHaveBeenCalledOnce();
    changes({
      cursor: "resource-change",
      reset: false,
      changes: [
        {
          id: crypto.randomUUID(),
          path: "_types/task.md",
          kind: "put",
          version: 1,
        },
      ],
    });
    await f.repository.initialize({ deferTaskIndex: true });
    expect(describe).toHaveBeenCalledTimes(2);
  });

  it("discards changed catalog bindings and reloads once under the original deadline", async () => {
    const f = await fixture();
    const control = heldWatch();
    let changes!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
      changes = callback;
      return control.watch;
    });
    const original = vi.mocked(f.client.describe).getMockImplementation()!;
    const describe = vi
      .spyOn(f.client, "describe")
      .mockImplementationOnce(async (options) => {
        const result = await original(options);
        changes(batch);
        return result;
      })
      .mockImplementation(original);
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await opened;
    expect(describe).toHaveBeenCalledTimes(2);
    expect(describe.mock.calls[0]![0]!.signal).toBe(
      describe.mock.calls[1]![0]!.signal,
    );
    await f.repository.initialize({ deferTaskIndex: true });
    expect(describe).toHaveBeenCalledTimes(2);
  });

  it.each(["catalog", "index"])(
    "converges after repeated %s invalidation under the original read-only owner",
    async (kind) => {
      const f = await fixture(),
        control = heldWatch();
      let changes!: (batch: wire.ChangesResult) => void;
      vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
        changes = callback;
        return control.watch;
      });
      const opened = f.repository.initialize({ deferTaskIndex: true });
      control.active();
      await opened;
      let count = 0;
      const signals: (AbortSignal | undefined)[] = [];
      if (kind === "catalog") {
        const original = vi.mocked(f.client.describe).getMockImplementation()!;
        vi.mocked(f.client.describe).mockImplementation(async (input) => {
          count++;
          signals.push(input?.signal);
          const result = await original(input);
          if (count <= 6) changes(batch);
          return result;
        });
        changes(batch);
      } else {
        vi.spyOn(f.client, "query").mockImplementation(
          async (_query, options) => {
            count++;
            signals.push(options?.signal);
            if (count <= 6) changes(batch);
            return { records: [], complete: true, asOf: 0 };
          },
        );
      }
      if (kind === "catalog")
        await expect(
          f.repository.initialize({ deferTaskIndex: true }),
        ).resolves.toBeUndefined();
      else await expect(f.repository.listSummaries()).resolves.toEqual([]);
      expect(count).toBe(7);
      if (kind === "catalog")
        expect(signals.every((signal) => signal === signals[0])).toBe(true);
      // Each index page is one request under its own deadline (#512).
      else expect(new Set(signals).size).toBe(signals.length);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
    },
  );

  it.each(["suspend", "dispose"] as const)(
    "%s cancels quiet-window catch-up without renewing the READ owner",
    async (action) => {
      const f = await fixture(),
        control = heldWatch();
      let changes!: (batch: wire.ChangesResult) => void;
      vi.spyOn(f.client, "watchChanges").mockImplementation((callback) => {
        changes = callback;
        return control.watch;
      });
      const original = vi.mocked(f.client.describe).getMockImplementation()!;
      const describe = vi
        .spyOn(f.client, "describe")
        .mockImplementation(async (signal) => {
          const result = await original(signal);
          changes(batch);
          return result;
        });
      const pending = f.repository.initialize({ deferTaskIndex: true });
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      control.active();
      await vi.waitFor(() =>
        expect(describe.mock.calls.length).toBeGreaterThanOrEqual(3),
      );
      f.repository[action]();
      await rejected;
      expect(control.stop).toHaveBeenCalledOnce();
      const calls = describe.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(describe).toHaveBeenCalledTimes(calls);
    },
  );

  it.each([
    new MdbaseError({
      code: "invalid_request",
      reason: "collection_changed",
      recovery: "fix_request",
      message: "A real error with a mismatched reason",
    }),
    new MdbaseError({
      code: "conflict",
      reason: "concurrent_modification",
      recovery: "refresh",
      message: "A real native refusal",
    }),
  ])(
    "does not retry or replace a real error: $code/$reason",
    async (problem) => {
      const f = await fixture(),
        control = heldWatch();
      vi.spyOn(f.client, "watchChanges").mockReturnValue(control.watch);
      const describe = vi
        .spyOn(f.client, "describe")
        .mockRejectedValue(problem);
      const pending = f.repository.initialize({ deferTaskIndex: true });
      control.active();
      await expect(pending).rejects.toBe(problem);
      expect(describe).toHaveBeenCalledOnce();
    },
  );

  it("does not let prior successful initialization clear known subscription failure", async () => {
    const f = await fixture();
    const control = heldWatch();
    vi.spyOn(f.client, "watchChanges").mockReturnValue(control.watch);
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await opened;
    control.stale(unavailable());
    await expect(
      f.repository.initialize({ deferTaskIndex: true }),
    ).rejects.toThrow("change feed");
    await expect(f.repository.connectionStatus()).resolves.toMatchObject({
      state: "unavailable",
    });
  });
});

it("a failed loaded watch requires a full scan, while catch-up on the same watch only reloads the model", async () => {
  const f = await fixture();
  await seed(f);
  const first = heldWatch();
  const original = f.client.watchChanges.bind(f.client);
  vi.spyOn(f.client, "watchChanges")
    .mockReturnValueOnce(first.watch)
    .mockImplementation(original);
  const initialized = f.repository.initialize();
  first.active();
  await initialized;
  const query = vi.spyOn(f.client, "query");
  const describe = vi.mocked(f.client.describe);
  describe.mockClear();
  first.stale(unavailable());
  first.active();
  expect(await f.repository.listSummaries()).toHaveLength(1);
  expect(describe).toHaveBeenCalledOnce();
  expect(query).not.toHaveBeenCalled();
  first.fail(unavailable());
  await expect(f.repository.listSummaries()).rejects.toThrow("change feed");
  expect(await f.repository.refresh()).toMatchObject({ scanned: 1 });
  expect(query).toHaveBeenCalledOnce();
});
