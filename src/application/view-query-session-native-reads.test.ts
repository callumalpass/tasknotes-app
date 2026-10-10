import { expect, it, vi } from "vitest";
import { MdbaseError } from "@mdbase-dev/sdk";
import { ViewQuerySession } from "./view-query-session";
import type { TaskRepository } from "./ports/task-repository";
import type { TaskView, TaskViewExecution } from "../domain/view";

// Single-slot transport stand-in: exercises UI sequencing, not native execution,
// discovery, current-source authority or browser/Worker qualification.
function fixture(type = "tasknotes.calendar") {
  const view: TaskView = {
    key: "selected#0",
    documentId: "selected",
    documentName: "Today",
    id: "0",
    name: "Today",
    properties: [],
    source: {
      path: "TaskNotes/Views/today.base",
      format: "obsidian.base",
      revision: "original",
      writable: false,
    },
    presentation: { type, mappings: {}, options: {} },
  };
  const result: TaskViewExecution = {
    view,
    rows: [],
    groups: [],
    totalCount: 0,
    hasMore: false,
  };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const events: string[] = [];
  let outstanding = false;
  const read = async (kind: string) => {
    if (outstanding)
      throw new MdbaseError({
        code: "too_large",
        recovery: "fix_request",
        message: "one Bases read is already outstanding",
      });
    outstanding = true;
    events.push(kind);
    try {
      if (events.length === 1) {
        entered();
        await held;
      } else await Promise.resolve();
    } finally {
      outstanding = false;
    }
  };
  const executeView = vi.fn(async (selected: TaskView) => {
    await read("execution-source");
    await read("execution");
    return { ...result, view: selected };
  });
  const readViewSource = vi.fn(async (path: string) => {
    await read("ui-source");
    return {
      ...view.source,
      path,
      document: "views:\n  - name: Today\n    type: tasknotesTaskList\n",
    };
  });
  const repository = {
    cachedViewExecution: async () => null,
    executeView,
    readViewSource,
    iterateView: async function* (selected: TaskView) {
      yield await executeView(selected);
    },
  } as unknown as TaskRepository;
  const observer = { result: vi.fn(), error: vi.fn(), pending: vi.fn() };
  const session = new ViewQuerySession(repository, view, observer);
  return {
    session,
    repository,
    observer,
    events,
    started,
    release,
    result,
  };
}

it.each(["tasknotes.task-list", "tasknotes.calendar"])(
  "serializes execution and optional source metadata with one read slot: %s",
  async (type) => {
    const f = fixture(type);
    const execution = f.session.start();
    const metadata = f.session.readSource();
    expect(f.session.readSource()).toBe(metadata);
    await f.started;
    f.release();
    await Promise.all([execution, metadata]);
    expect(f.events).toEqual(["execution-source", "execution", "ui-source"]);
    expect(f.observer.error).not.toHaveBeenCalled();
    expect(f.observer.result).toHaveBeenLastCalledWith(f.result);
    expect(f.repository.readViewSource).toHaveBeenCalledOnce();
    f.session.close();
  },
);

it("serializes execution behind a source read that was requested first", async () => {
  const f = fixture();
  const metadata = f.session.readSource();
  const execution = f.session.start();
  await f.started;
  f.release();
  await Promise.all([metadata, execution]);
  expect(f.events).toEqual(["ui-source", "execution-source", "execution"]);
  expect(f.observer.error).not.toHaveBeenCalled();
  expect(f.observer.result).toHaveBeenLastCalledWith(f.result);
  f.session.close();
});

it("does not start queued metadata or publish late execution after close", async () => {
  const f = fixture();
  const execution = f.session.start();
  const metadata = f.session.readSource();
  const cancelled = expect(metadata).rejects.toMatchObject({
    name: "AbortError",
  });
  await f.started;
  f.session.close();
  f.release();
  await Promise.all([execution, cancelled]);
  expect(f.repository.readViewSource).not.toHaveBeenCalled();
  expect(f.observer.result).not.toHaveBeenCalled();
  expect(f.observer.error).not.toHaveBeenCalled();
});

it("does not dispatch queued execution after closing during metadata", async () => {
  const f = fixture();
  const metadata = f.session.readSource();
  const cancelled = expect(metadata).rejects.toMatchObject({
    name: "AbortError",
  });
  const execution = f.session.start();
  await f.started;
  f.session.close();
  f.release();
  await Promise.all([execution, cancelled]);
  expect(f.events).toEqual(["ui-source"]);
  expect(f.repository.executeView).not.toHaveBeenCalled();
  expect(f.observer.result).not.toHaveBeenCalled();
  expect(f.observer.error).not.toHaveBeenCalled();
});

it("preserves an execution failure while still allowing source inspection", async () => {
  const f = fixture();
  const failure = new Error("Execution unavailable");
  vi.spyOn(f.repository, "executeView").mockRejectedValueOnce(failure);
  const execution = f.session.start();
  const metadata = f.session.readSource();
  await f.started;
  f.release();
  await Promise.all([execution, metadata]);
  expect(f.events).toEqual(["ui-source"]);
  expect(f.observer.error).toHaveBeenCalledWith(failure);
  expect(f.observer.result).not.toHaveBeenCalled();
  f.session.close();
});

it("orders replacement-view reads behind a closed session's active metadata read", async () => {
  const f = fixture();
  const oldMetadata = f.session.readSource();
  const cancelled = expect(oldMetadata).rejects.toMatchObject({
    name: "AbortError",
  });
  await f.started;
  f.session.close();
  const nextView = {
    ...f.result.view,
    key: "next#0",
    documentId: "next",
    documentName: "Upcoming",
    name: "Upcoming",
    source: {
      ...f.result.view.source,
      path: "TaskNotes/Views/upcoming.base",
      revision: "next",
    },
  };
  const observer = { result: vi.fn(), error: vi.fn(), pending: vi.fn() };
  const next = new ViewQuerySession(f.repository, nextView, observer);
  const execution = next.start();
  const metadata = next.readSource();
  try {
    // Advance the deferred start and its initial cursor cleanup, while the
    // original metadata read still owns the single transport slot.
    await Promise.resolve();
    await Promise.resolve();
    expect(f.repository.executeView).not.toHaveBeenCalled();
    expect(f.repository.readViewSource).toHaveBeenCalledOnce();
  } finally {
    f.release();
    await Promise.allSettled([execution, metadata, cancelled]);
  }
  const [, source] = await Promise.all([execution, metadata, cancelled]);
  expect(source.path).toBe(nextView.source.path);
  expect(f.events).toEqual([
    "ui-source",
    "execution-source",
    "execution",
    "ui-source",
  ]);
  expect(f.observer.result).not.toHaveBeenCalled();
  expect(observer.error).not.toHaveBeenCalled();
  expect(observer.result).toHaveBeenLastCalledWith({
    ...f.result,
    view: nextView,
  });
  expect(f.repository.executeView).toHaveBeenCalledExactlyOnceWith(nextView);
  expect(f.repository.readViewSource).toHaveBeenNthCalledWith(
    2,
    nextView.source.path,
  );
  next.close();
});

it("skips an obsolete replacement queued behind an old metadata read", async () => {
  const f = fixture();
  const oldMetadata = f.session.readSource();
  const cancelled = expect(oldMetadata).rejects.toMatchObject({
    name: "AbortError",
  });
  await f.started;
  f.session.close();
  const observer = { result: vi.fn(), error: vi.fn(), pending: vi.fn() };
  const replacement = new ViewQuerySession(
    f.repository,
    f.result.view,
    observer,
  );
  const execution = replacement.start();
  const metadata = replacement.readSource();
  const skipped = expect(metadata).rejects.toMatchObject({
    name: "AbortError",
  });
  replacement.close();
  f.release();
  await Promise.all([execution, cancelled, skipped]);
  expect(f.events).toEqual(["ui-source"]);
  expect(f.repository.executeView).not.toHaveBeenCalled();
  expect(f.repository.readViewSource).toHaveBeenCalledOnce();
  expect(observer.result).not.toHaveBeenCalled();
  expect(observer.error).not.toHaveBeenCalled();
});

it("does not block a different repository behind an old source read", async () => {
  const old = fixture();
  const other = fixture();
  const metadata = old.session.readSource();
  await old.started;
  const execution = other.session.start();
  await other.started;
  other.release();
  await execution;
  expect(other.observer.result).toHaveBeenLastCalledWith(other.result);
  expect(other.observer.error).not.toHaveBeenCalled();
  expect(old.events).toEqual(["ui-source"]);
  old.release();
  await metadata;
  old.session.close();
  other.session.close();
});

it("does not let a failed metadata read poison a later execution", async () => {
  const f = fixture();
  vi.spyOn(f.repository, "readViewSource").mockRejectedValueOnce(
    new Error("Source unavailable"),
  );
  const metadata = f.session.readSource();
  const rejected = expect(metadata).rejects.toThrow("Source unavailable");
  const execution = f.session.start();
  await f.started;
  f.release();
  await Promise.all([execution, rejected]);
  expect(f.events).toEqual(["execution-source", "execution"]);
  expect(f.observer.error).not.toHaveBeenCalled();
  expect(f.observer.result).toHaveBeenLastCalledWith(f.result);
  f.session.close();
});
