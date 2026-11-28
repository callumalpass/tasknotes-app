import { afterEach, expect, it, vi } from "vitest";
import { calendarItems } from "../src/app/calendar-items";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import { calendarEvents } from "../src/domain/calendar-events";
import {
  projectTodayTasks,
  taskOccurrencesBetween,
} from "../src/domain/task-occurrence";
import { summarizeToday } from "../src/domain/today-summary";

afterEach(() => vi.useRealTimers());

it.runIf(process.env.TASKNOTES_BENCH_FORMATTING === "1")(
  "measures Today, Inbox and Calendar projections with 10,000 recurring tasks",
  async () => {
    const now = "2026-11-04T12:00:00Z";
    const today = now.slice(0, 10);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    const repository = new DemoTaskRepository(1, undefined, {
      tasks: (model) =>
        Array.from({ length: 12_000 }, (_, index) =>
          model.create(
            {
              title: `Series ${index}`,
              scheduled: index < 8_000 ? "2026-10-05" : undefined,
              recurrence:
                index >= 10_000
                  ? undefined
                  : index % 2
                    ? "FREQ=WEEKLY;BYDAY=MO,WE,FR"
                    : "FREQ=DAILY",
            },
            {
              id: `series-${index}`,
              now: new Date(Date.parse(now) - index * 3_600_000).toISOString(),
            },
          ),
        ),
      scratchpads: () => [],
    });
    const configuration = await repository.taskConfiguration();
    const views = (await repository.listViews()).flatMap((doc) => doc.views);
    const calendar = views.find((view) => view.id === "calendar")!;
    const inbox = views.find((view) => view.id === "inbox")!;
    const execution = await repository.executeView(calendar);
    const tasks = await repository.listSummaries({
      status: "all",
      limit: 50_000,
    });
    const start = new Date("2026-10-25T00:00:00Z");
    const end = new Date("2026-12-06T00:00:00Z");
    const samples = {
      todaySummary: [] as number[],
      todayOccurrences: [] as number[],
      inboxView: [] as number[],
      rruleDateExpansion: [] as number[],
      calendarOccurrences: [] as number[],
      calendarProjection: [] as number[],
    };
    let counts = {};
    for (let round = 0; round <= 7; round++) {
      const measure = async <T>(
        key: keyof typeof samples,
        operation: () => T | Promise<T>,
      ) => {
        const since = performance.now();
        const result = await operation();
        if (round) samples[key].push(Math.round(performance.now() - since));
        return result;
      };
      const summary = await measure("todaySummary", () =>
        summarizeToday(tasks, today),
      );
      const todayRows = await measure("todayOccurrences", () =>
        projectTodayTasks(tasks, "2026-10-05", today, 100),
      );
      const inboxRows = await measure("inboxView", () =>
        repository.executeView(inbox),
      );
      const recurring = tasks.filter((task) => task.recurrence);
      await measure("rruleDateExpansion", () =>
        recurring.reduce(
          (total, task) =>
            total +
            taskOccurrencesBetween(task, "2026-10-25", "2026-12-05").length,
          0,
        ),
      );
      const calendarRows = await measure("calendarOccurrences", () =>
        calendarEvents(execution, start, end, tasks, {}, configuration),
      );
      const items = await measure(
        "calendarProjection",
        () =>
          calendarItems(calendarRows, execution, "title", configuration).items,
      );
      counts = {
        next: summary.next?.date,
        today: todayRows.totalCount,
        inbox: inboxRows.totalCount,
        calendar: items.length,
      };
      expect(recurring).toHaveLength(10_000);
      expect(tasks).toHaveLength(12_000);
      expect(summary.next?.date).toBe("2026-11-05");
      expect(inboxRows.totalCount).toBe(2_000);
      expect(items.length).toBeGreaterThan(100_000);
    }
    const medianMs = Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [
        key,
        [...values].sort((a, b) => a - b)[3],
      ]),
    );
    console.log(JSON.stringify({ counts, medianMs, samples }));
  },
  180_000,
);
