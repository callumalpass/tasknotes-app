import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TaskRepository,
  RepositoryChange,
} from "../application/ports/task-repository";
import { todayString, type TaskListQuery } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";

export interface TaskRepositoryContractFixture {
  /** Empty task collection; transport/cursor simulation belongs in the fixture. */
  repository: TaskRepository;
  cleanup?(): Promise<void> | void;
}

/** UI-facing semantics of the real adapter, not a remote engine conformance test.
 * Provider-specific assignments, conflicts and uncertain receipts stay in adapter tests.
 * list has a fixed domain order; saved-view order/cursors belong to iterateView.
 */
export function taskRepositoryContract(
  adapter: string,
  createFixture: () => Promise<TaskRepositoryContractFixture>,
): void {
  describe(`${adapter} TaskRepository contract`, () => {
    let fixture: TaskRepositoryContractFixture;
    let repository: TaskRepository;

    beforeEach(async () => {
      fixture = await createFixture();
      repository = fixture.repository;
      await repository.initialize();
    });

    afterEach(async () => {
      repository.dispose?.();
      await fixture.cleanup?.();
      vi.useRealTimers();
    });

    async function listView(): Promise<TaskView> {
      const view = (await repository.listViews()).flatMap(
        ({ views }) => views,
      )[0]!;
      return {
        ...view,
        presentation: {
          type: "tasknotes.task-list",
          mappings: {},
          options: {},
        },
      };
    }

    it("initializes idempotently and exposes collection capabilities", async () => {
      await repository.initialize();
      await repository.initialize({ deferTaskIndex: true });
      expect(await repository.collectionInfo()).toMatchObject({
        name: expect.any(String),
        location: expect.any(String),
      });
      expect(await repository.taskConfiguration()).toMatchObject({
        statuses: expect.any(Array),
      });
      expect(await repository.connectionStatus()).toMatchObject({
        state: "connected",
      });
      expect(await repository.list()).toEqual([]);
    });

    it("creates model defaults and separates summaries from complete documents", async () => {
      const configuration = await repository.taskConfiguration();
      const task = await repository.create({
        title: "Contract defaults",
        body: "Exact notes\n",
      });
      expect(task).toMatchObject({
        status: configuration.defaults.status,
        priority: configuration.defaults.priority,
        completed: false,
        archived: false,
        contexts: [],
        projects: [],
        reminders: [],
        body: "Exact notes\n",
      });
      expect(task.createdAt).toBeTruthy();
      expect(task.updatedAt).toBeTruthy();
      expect(await repository.get(task.id)).toEqual(task);
      const summary = await repository.getSummary(task.id);
      expect(summary).not.toHaveProperty("body");
      expect(await repository.listSummaries()).toEqual([summary]);
      expect(await repository.list()).toEqual([task]);
      expect(await repository.get("missing")).toBeNull();
      expect(await repository.getSummary("missing")).toBeNull();
    });

    it("reuses accepted create intents without deduplicating independent submissions", async () => {
      const intent = { id: crypto.randomUUID() };
      const input = { title: "Same capture" };
      const accepted = await repository.create(input, intent);
      expect(await repository.create(input, intent)).toEqual(accepted);
      const independent = await repository.create(input, {
        id: crypto.randomUUID(),
      });
      expect(independent.id).not.toBe(accepted.id);
      expect(independent.path).not.toBe(accepted.path);
      expect((await repository.stats()).total).toBe(2);
    });

    it("creates directly in a completed status with a completion date", async () => {
      const task = await repository.create({
        title: "Already done",
        status: "done",
      });
      expect(task).toMatchObject({
        completed: true,
        completedDate: expect.any(String),
      });
      expect(await repository.list()).toEqual([]);
    });

    it("uses accepted model settings for subsequent creates and inherited defaults", async () => {
      const task = await repository.create({
        title: "Inherited occurrence policy",
      });
      const before = task.frontmatter;
      await repository.updateTaskModelSettings({
        defaultPriority: "high",
        occurrences: { defaultMaterialization: "rolling" },
      });
      expect(
        (await repository.create({ title: "New defaults" })).priority,
      ).toBe("high");
      expect(
        (await repository.getSummary(task.id))?.occurrenceMaterialization,
      ).toBe("rolling");
      expect((await repository.get(task.id))?.frontmatter).toEqual(before);
    });

    it("honors a completed model default at creation", async () => {
      await repository.updateTaskModelSettings({ defaultStatus: "done" });
      const task = await repository.create({ title: "Completed default" });
      expect(task).toMatchObject({
        status: "done",
        completed: true,
        completedDate: expect.any(String),
      });
    });

    it("defaults to open/unarchived and applies status/archive filters before limits", async () => {
      const open = await repository.create({ title: "Open" });
      const done = await repository.create({ title: "Done", status: "done" });
      const archivedOpen = await repository.create({ title: "Archived open" });
      const archivedDone = await repository.create({
        title: "Archived done",
        status: "done",
      });
      await repository.setArchived(archivedOpen.id, true);
      await repository.setArchived(archivedDone.id, true);
      const cases: Array<[TaskListQuery, string[]]> = [
        [{}, [open.id]],
        [{ status: "open" }, [open.id]],
        [{ status: "completed" }, [done.id]],
        [{ status: "all" }, [open.id, done.id]],
        [{ archived: "only" }, [archivedOpen.id]],
        [{ archived: "only", status: "completed" }, [archivedDone.id]],
        [
          { archived: "include", status: "all" },
          [open.id, done.id, archivedOpen.id, archivedDone.id],
        ],
      ];
      for (const [query, ids] of cases) {
        expect(
          (await repository.list(query)).map(({ id }) => id).sort(),
        ).toEqual([...ids].sort());
        expect(
          (await repository.listSummaries(query)).map(({ id }) => id).sort(),
        ).toEqual([...ids].sort());
        expect(
          (await repository.search(query)).map(({ task }) => task.id).sort(),
        ).toEqual([...ids].sort());
      }
      expect(
        await repository.list({ status: "completed", limit: 1 }),
      ).toMatchObject([{ id: done.id }]);
    });

    it("orders by completion, scheduled-or-due, priority, updated date, then path", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
      const low = await repository.create({
        title: "Low",
        scheduled: "2026-08-03",
        priority: "low",
      });
      const due = await repository.create({
        title: "Earlier due",
        due: "2026-08-02",
      });
      const scheduled = await repository.create({
        title: "Schedule wins over due",
        scheduled: "2026-08-04",
        due: "2026-08-01",
      });
      const high = await repository.create({
        title: "High",
        scheduled: "2026-08-03",
        priority: "high",
      });
      const a = await repository.create({ title: "A tie" });
      const z = await repository.create({ title: "Z tie" });
      vi.setSystemTime(new Date("2026-08-01T12:00:01Z"));
      const newer = await repository.create({ title: "Newer" });
      const done = await repository.create({
        title: "Completed sorts last",
        status: "done",
        scheduled: "2026-08-01",
      });
      const expected = [
        due.id,
        high.id,
        low.id,
        scheduled.id,
        newer.id,
        ...[a, z].sort((l, r) => l.path.localeCompare(r.path)).map((t) => t.id),
        done.id,
      ];
      expect(
        (await repository.list({ status: "all" })).map((t) => t.id),
      ).toEqual(expected);
      expect(
        (await repository.search({ status: "all" })).map((r) => r.task.id),
      ).toEqual(expected);
    });

    it("honors zero, positive, negative and default 500 limits for all query surfaces", async () => {
      for (let index = 0; index < 503; index++)
        await repository.create({ title: `Limit ${index}` });
      for (const [limit, length] of [
        [undefined, 500],
        [0, 0],
        [2, 2],
        [2.9, 2],
        [Number.NaN, 0],
        [Infinity, 503],
        [-1, 502],
      ] as const) {
        expect(await repository.list({ limit })).toHaveLength(length);
        expect(await repository.listSummaries({ limit })).toHaveLength(length);
        expect(
          await repository.search({ search: "Limit", limit }),
        ).toHaveLength(length);
      }
    });

    it("matches normalized AND tokens across title, notes and metadata (B8b)", async () => {
      const task = await repository.create({
        title: "Audit needle",
        body: "Rarebody and notes",
        tags: ["tagtoken"],
        contexts: ["contexttoken"],
        projects: ["[[Projects/projecttoken]]"],
        attachments: ["[[Files/attachmenttoken.png]]"],
      });
      await repository.create({ title: "Audit needle only" });
      const search =
        "  NEEDLE   rarebody rarebody tagtoken contexttoken projecttoken attachmenttoken  ";
      const results = await repository.search({ search });
      expect(results).toHaveLength(1);
      expect(results[0].task.id).toBe(task.id);
      expect(results[0].task).not.toHaveProperty("body");
      expect(results[0].bodyMatches).toEqual(["rarebody"]);
      expect(await repository.list({ search })).toMatchObject([
        { id: task.id, body: "Rarebody and notes" },
      ]);
      expect(await repository.search({ search: "needle absent" })).toEqual([]);
      expect(await repository.search({ search, limit: 0 })).toEqual([]);
      expect(await repository.search({ search: "   " })).toHaveLength(2);
    });

    it("keeps archived counts separate from total/open/completed", async () => {
      const open = await repository.create({ title: "Open" });
      const done = await repository.create({ title: "Done", status: "done" });
      expect(await repository.stats()).toEqual({
        total: 2,
        open: 1,
        completed: 1,
        archived: 0,
      });
      await repository.setArchived(done.id, true);
      expect(await repository.stats()).toEqual({
        total: 1,
        open: 1,
        completed: 0,
        archived: 1,
      });
      await repository.setArchived(open.id, true);
      expect(await repository.stats()).toEqual({
        total: 0,
        open: 0,
        completed: 0,
        archived: 2,
      });
      await repository.setArchived(done.id, false);
      expect(await repository.stats()).toEqual({
        total: 1,
        open: 0,
        completed: 1,
        archived: 1,
      });
    });

    it("updates exact bodies and clears nullable/array fields while retaining identity", async () => {
      const task = await repository.create({
        title: "Editable",
        body: "Original\n",
        due: "2026-08-02",
        scheduled: "2026-08-01",
        tags: ["old"],
        reminders: [
          { id: "r", type: "absolute", absoluteTime: "2099-01-01T00:00:00Z" },
        ],
      });
      const updated = await repository.update(task.id, {
        title: "Edited",
        body: "Exact Markdown\n\n",
        due: null,
        scheduled: null,
        tags: [],
        reminders: [],
      });
      expect(updated).toMatchObject({
        id: task.id,
        title: "Edited",
        body: "Exact Markdown\n\n",
        reminders: [],
        frontmatter: { id: task.id },
      });
      // The canonical membership tag may remain; user tags must be cleared.
      expect(updated.tags).not.toContain("old");
      expect(updated.due).toBeUndefined();
      expect(updated.scheduled).toBeUndefined();
      expect(updated.revision).toBeGreaterThan(task.revision);
      expect(await repository.get(task.id)).toEqual(updated);
    });

    it("uses model archive path policy without changing task identity or body", async () => {
      await repository.updateTaskModelSettings({
        archive: { moveOnArchive: true, folder: "Contract/Archive" },
      });
      const task = await repository.create({
        title: "Move archive",
        body: "Portable notes\n",
      });
      const archived = await repository.setArchived(task.id, true);
      expect(archived.path).toMatch(/^Contract\/Archive\//);
      expect(archived).toMatchObject({
        id: task.id,
        archived: true,
        body: task.body,
      });
      const reopened = await repository.setArchived(task.id, false);
      expect(reopened).toMatchObject({
        id: task.id,
        archived: false,
        body: task.body,
      });
      expect(reopened.path).not.toMatch(/^Contract\/Archive\//);
    });

    it("tracks time, reports an already-active error and auto-stops on completion", async () => {
      await repository.updateTaskModelSettings({
        timeTracking: { autoStopOnComplete: true },
      });
      const task = await repository.create({ title: "Timed" });
      const running = await repository.startTimeTracking(
        task.id,
        "Contract work",
      );
      expect(running.timeEntries).toHaveLength(1);
      expect(running.timeEntries[0]).toMatchObject({
        startTime: expect.any(String),
        description: "Contract work",
      });
      await expect(repository.startTimeTracking(task.id)).rejects.toThrow(
        "time_tracking_already_active",
      );
      const done = await repository.toggle(task.id, undefined, true);
      expect(done.timeEntries[0].endTime).toEqual(expect.any(String));
      expect(
        (await repository.replaceTimeEntries(task.id, [])).timeEntries,
      ).toEqual([]);
    });

    it("batch-updates in input order, supports empty batches and idempotent deletion", async () => {
      const first = await repository.create({ title: "Alpha" });
      const second = await repository.create({ title: "Beta" });
      expect(await repository.updateMany([])).toEqual([]);
      expect(
        await repository.updateMany([
          { id: first.id, input: { priority: "high" } },
          { id: second.id, input: { status: "done" } },
        ]),
      ).toMatchObject([
        { id: first.id, priority: "high" },
        { id: second.id, completed: true },
      ]);
      await repository.delete(first.id);
      await repository.delete(first.id);
      expect(await repository.get(first.id)).toBeNull();
      expect(await repository.getSummary(first.id)).toBeNull();
      expect(await repository.stats()).toEqual({
        total: 1,
        open: 0,
        completed: 1,
        archived: 0,
      });
    });

    it("does not publish data changes for empty batches or already-missing deletion", async () => {
      const changed = vi.fn();
      const unsubscribe = repository.subscribe(changed);
      await repository.updateMany([]);
      await repository.delete("missing");
      expect(changed).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("converges desired completion, reopens and maintains completion dates", async () => {
      const task = await repository.create({ title: "Complete" });
      const done = await repository.toggle(task.id, undefined, true);
      expect(done).toMatchObject({
        completed: true,
        status: "done",
        completedDate: expect.any(String),
      });
      const again = await repository.toggle(task.id, undefined, true);
      expect(again.revision).toBe(done.revision);
      const reopened = await repository.toggle(task.id, undefined, false);
      expect(reopened.completed).toBe(false);
      expect(reopened.completedDate).toBeUndefined();
      expect((await repository.toggle(task.id)).completed).toBe(true);
    });

    it("completes and skips inline recurrence dates without completing the series", async () => {
      const parent = await repository.create({
        title: "Daily",
        scheduled: "2026-08-05",
        recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
      });
      const done = await repository.toggle(parent.id, "2026-08-05", true);
      expect(done.completed).toBe(false);
      expect(done.completeInstances).toContain("2026-08-05");
      expect(
        (await repository.toggle(parent.id, "2026-08-05", true)).revision,
      ).toBe(done.revision);
      expect(
        (await repository.toggle(parent.id, "2026-08-05", false))
          .completeInstances,
      ).not.toContain("2026-08-05");
      expect(
        (await repository.skip(parent.id, "2026-08-06")).skippedInstances,
      ).toContain("2026-08-06");
    });

    it("materializes once and reconciles occurrence completion/reopening/skipping with its parent", async () => {
      const parent = await repository.create({
        title: "Series",
        scheduled: "2026-08-05",
        recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
      });
      const first = await repository.materializeOccurrence(
        parent.id,
        "2026-08-05",
      );
      expect(first.created).toBe(true);
      expect(
        await repository.materializeOccurrence(parent.id, "2026-08-05"),
      ).toMatchObject({ created: false, task: { id: first.task.id } });
      const done = await repository.toggle(first.task.id, undefined, true);
      expect(done.completed).toBe(true);
      expect((await repository.get(parent.id))?.completeInstances).toContain(
        "2026-08-05",
      );
      expect(
        (await repository.toggle(first.task.id, undefined, true)).revision,
      ).toBe(done.revision);
      await repository.toggle(first.task.id, undefined, false);
      expect(
        (await repository.get(parent.id))?.completeInstances,
      ).not.toContain("2026-08-05");
      // Starter models have no skipped status: do not invent one in the demo.
      await expect(
        repository.skip(first.task.id, "2026-08-05"),
      ).rejects.toThrow("missing_skipped_status");
      expect((await repository.get(parent.id))?.skippedInstances).not.toContain(
        "2026-08-05",
      );
    });

    it("materializes the next occurrence under on-completion policy", async () => {
      const parent = await repository.create({
        title: "Next series",
        scheduled: "2026-08-05",
        recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
        occurrenceMaterialization: "on_completion",
      });
      const first = await repository.materializeOccurrence(
        parent.id,
        "2026-08-05",
      );
      await repository.toggle(first.task.id, undefined, true);
      expect(await repository.list({ status: "all", limit: 100 })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ occurrenceDate: "2026-08-06" }),
        ]),
      );
    });

    it("maintains a bounded rolling occurrence window and refreshes it idempotently", async () => {
      const today = todayString();
      const parent = await repository.create({
        title: "Rolling series",
        scheduled: today,
        recurrence: `FREQ=DAILY;DTSTART=${today.replaceAll("-", "")}`,
        occurrenceMaterialization: "rolling",
        occurrencePastHorizon: "P0D",
        occurrenceFutureHorizon: "P2D",
      });
      const occurrences = (await repository.list({ status: "all" })).filter(
        (task) => task.occurrenceDate,
      );
      expect(occurrences).toHaveLength(3);
      expect(new Set(occurrences.map((task) => task.occurrenceDate)).size).toBe(
        3,
      );
      expect(occurrences.every((task) => task.recurrenceParent)).toBe(true);
      await repository.refresh();
      expect((await repository.stats()).total).toBe(4);
      expect(
        (await repository.materializeOccurrence(parent.id, today)).created,
      ).toBe(false);
    });

    it("publishes data versus quiet refresh/status changes and respects unsubscribe", async () => {
      const changed = vi.fn<(change?: RepositoryChange) => void>();
      const unsubscribe = repository.subscribe(changed);
      await repository.create({ title: "Event" });
      expect(changed).toHaveBeenCalledWith({ kind: "data" });
      changed.mockClear();
      const result = await repository.refresh();
      expect(result).toMatchObject({
        changed: 0,
        removed: 0,
        scanned: expect.any(Number),
        elapsedMs: expect.any(Number),
      });
      expect(changed).toHaveBeenCalledWith({ kind: "status" });
      expect(changed).not.toHaveBeenCalledWith({ kind: "data" });
      unsubscribe();
      changed.mockClear();
      await repository.create({ title: "Unsubscribed" });
      expect(changed).not.toHaveBeenCalled();
    });

    it("delivers caller-driven view pages, cumulative cache and whole-query counts", async () => {
      for (let index = 0; index < 401; index++)
        await repository.create({ title: `Page ${index}` });
      const view = await listView();
      const iterator = repository.iterateView!(view)[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value.rows).toHaveLength(200);
      expect(first.value).toMatchObject({ totalCount: 401, hasMore: true });
      expect((await repository.cachedViewExecution(view))?.rows).toHaveLength(
        200,
      );
      const second = await iterator.next();
      expect(second.value.rows).toHaveLength(200);
      expect(second.value).toMatchObject({ totalCount: 401, hasMore: true });
      const third = await iterator.next();
      expect(third.value.rows).toHaveLength(1);
      expect(third.value.hasMore).toBe(false);
      expect((await repository.cachedViewExecution(view))?.rows).toHaveLength(
        401,
      );
      expect((await iterator.next()).done).toBe(true);
      const ids = [first.value, second.value, third.value].flatMap(
        (page: TaskViewExecution) => page.rows.map((row) => row.task!.id),
      );
      expect(new Set(ids).size).toBe(401);
      expect(
        (await repository.executeView(view)).rows.map((row) => row.task!.id),
      ).toEqual(ids);
    });

    it("closes/aborts a view cursor without poisoning a fresh read", async () => {
      await repository.create({ title: "Cursor" });
      const view = await listView();
      const controller = new AbortController();
      const aborted = repository.iterateView!(view, {
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      controller.abort();
      await expect(aborted.next()).rejects.toMatchObject({
        name: "AbortError",
      });
      const cursor = repository.iterateView!(view)[Symbol.asyncIterator]();
      await cursor.next();
      await cursor.return?.();
      expect((await cursor.next()).done).toBe(true);
      expect((await repository.executeView(view)).rows).toHaveLength(1);
    });

    it("interrupts foreground cursors on suspend, announces resume and remains connected", async () => {
      for (let index = 0; index < 201; index++)
        await repository.create({ title: `Lifecycle ${index}` });
      const view = await listView();
      const cursor = repository.iterateView!(view)[Symbol.asyncIterator]();
      expect((await cursor.next()).value.hasMore).toBe(true);
      repository.suspend?.();
      await expect(cursor.next()).rejects.toMatchObject({ name: "AbortError" });
      const changed = vi.fn();
      const unsubscribe = repository.subscribe(changed);
      repository.resume?.();
      expect(changed).toHaveBeenCalledWith({ kind: "lifecycle" });
      expect((await repository.connectionStatus()).state).toBe("connected");
      await repository.refresh();
      const fresh = repository.iterateView!(view)[Symbol.asyncIterator]();
      expect((await fresh.next()).value.rows).toHaveLength(200);
      expect((await fresh.next()).value.rows).toHaveLength(1);
      expect((await fresh.next()).done).toBe(true);
      unsubscribe();
    });

    it("paginates Scratchpad history without duplicates/current and rejects invalid cursors", async () => {
      const created: string[] = [];
      for (let index = 0; index < 3; index++) {
        const current = await repository.getActiveScratchpad!();
        const next = await repository.startNewScratchpad!({
          id: current.id,
          path: current.path,
          revision: current.revision,
          baseBody: current.body,
          body: current.body,
        });
        created.push(next.previous.id);
      }
      const first = await repository.listScratchFeed!({ limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeTruthy();
      const items = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await repository.listScratchFeed!({ limit: 1, cursor });
        expect(page.current.id).toBe(first.current.id);
        items.push(...page.items);
        cursor = page.nextCursor;
      }
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      expect(items.map((item) => item.id)).toEqual(
        expect.arrayContaining(created),
      );
      expect(items.map((item) => item.id)).not.toContain(first.current.id);
      await expect(
        repository.listScratchFeed!({ cursor: "invalid" }),
      ).rejects.toThrow("The scratchpad feed page is invalid. Reload it.");
    });

    it("preserves caller cancellation for document and search reads", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        repository.list({}, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      await expect(
        repository.search(
          { search: "anything" },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("returns actionable missing-task and domain validation errors without accepting writes", async () => {
      await expect(
        repository.update("missing", { title: "No" }),
      ).rejects.toThrow("Task not found.");
      await expect(repository.toggle("missing")).rejects.toThrow(
        "Task not found.",
      );
      await expect(repository.create({ title: "" })).rejects.toMatchObject({
        name: "Error",
        message: "A task title is required.",
      });
      await expect(
        repository.create({ title: "Invalid date", scheduled: "not-a-date" }),
      ).rejects.toMatchObject({
        name: "TaskNotesValidationError",
        issues: expect.any(Array),
      });
      expect(await repository.stats()).toEqual({
        total: 0,
        open: 0,
        completed: 0,
        archived: 0,
      });
    });
  });
}
