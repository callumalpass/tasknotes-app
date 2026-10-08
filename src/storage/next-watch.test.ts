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
      { body: true, effective: true },
    ),
  };
}

describe("native change invalidation (SDK stand-in, not Core/Noise/LAB)", () => {
  it("accepts an actual empty watch ACK without claiming the task index is loaded", async () => {
    const f = await fixture();
    const watch = vi.spyOn(f.client, "watchChanges");
    const pages = vi.spyOn(f.client, "pages");
    await f.repository.initialize({ deferTaskIndex: true });
    expect(watch.mock.results[0]!.value.state).toBe("active");
    expect(pages).not.toHaveBeenCalled();
    await f.repository.listSummaries();
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

  it("refuses to install a snapshot invalidated while its pages were loading", async () => {
    const f = await fixture();
    const control = heldWatch();
    let changes!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges").mockImplementation(
      (_cursor, callback) => {
        changes = callback;
        return control.watch;
      },
    );
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await opened;
    const page = { records: [], complete: true, asOf: 0 };
    vi.spyOn(f.client, "pages").mockImplementationOnce(async function* () {
      yield page;
      changes(batch);
    });
    await expect(f.repository.listSummaries()).rejects.toMatchObject({
      code: "conflict",
      reason: "collection_changed",
    });
    expect(await f.repository.listSummaries()).toEqual([]);
  });

  it.each(["remote", "local"])(
    "%s data events do not let new reads join an obsolete index snapshot",
    async (kind) => {
      const f = await fixture(),
        control = heldWatch();
      let changes!: (batch: wire.ChangesResult) => void;
      vi.spyOn(f.client, "watchChanges").mockImplementation(
        (_cursor, callback) => {
          changes = callback;
          return control.watch;
        },
      );
      const opened = f.repository.initialize({ deferTaskIndex: true });
      control.active();
      await opened;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pages = vi
        .spyOn(f.client, "pages")
        .mockImplementationOnce(async function* () {
          await gate;
          yield { records: [], complete: true, asOf: 0 };
        })
        .mockImplementation(async function* () {
          yield { records: [], complete: true, asOf: 1 };
        });
      const stale = f.repository.listSummaries();
      const refused = expect(stale).rejects.toMatchObject({
        reason: "collection_changed",
      });
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
        await vi.waitFor(() => expect(finished).toBe(true));
        expect(failure).toBeUndefined();
        expect(result).toEqual([]);
        expect(pages).toHaveBeenCalledTimes(2);
      } finally {
        release();
      }
      await refused;
      await current;
    },
  );

  it("stops startup on suspend and ignores callbacks from the retired scope after resume", async () => {
    const f = await fixture();
    const old = heldWatch();
    const current = heldWatch();
    let oldCallback!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges")
      .mockImplementationOnce((_cursor, callback) => {
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
    vi.spyOn(f.client, "watchChanges").mockImplementation(
      (_cursor, callback) => {
        changes = callback;
        return control.watch;
      },
    );
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

  it("rejects catalog installation if it changes while bindings are loading", async () => {
    const f = await fixture();
    const control = heldWatch();
    let changes!: (batch: wire.ChangesResult) => void;
    vi.spyOn(f.client, "watchChanges").mockImplementation(
      (_cursor, callback) => {
        changes = callback;
        return control.watch;
      },
    );
    const original = vi.mocked(f.client.describe).getMockImplementation()!;
    vi.spyOn(f.client, "describe")
      .mockImplementationOnce(async (signal) => {
        const result = await original(signal);
        changes(batch);
        return result;
      })
      .mockImplementation(original);
    const opened = f.repository.initialize({ deferTaskIndex: true });
    control.active();
    await expect(opened).rejects.toMatchObject({
      reason: "collection_changed",
    });
    await f.repository.initialize({ deferTaskIndex: true });
  });

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
