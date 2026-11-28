import { expect, it, vi } from "vitest";
import { calendarItems } from "../src/app/calendar-items";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import { demoTasks } from "../src/demo/demo-tasks";
import { calendarEvents } from "../src/domain/calendar-events";

it.runIf(process.env.TASKNOTES_BENCH_FORMATTING === "1")(
  "measures a cold calendar projection and first board page for 10,000 tasks",
  async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    try {
      const repository = new DemoTaskRepository(1, undefined, {
        tasks: (model) => demoTasks(model, 10_000),
        scratchpads: () => [],
      });
      const configuration = await repository.taskConfiguration();
      const views = (await repository.listViews()).flatMap((doc) => doc.views);
      const board = views.find((view) => view.id === "work-board")!;
      const calendar = views.find((view) => view.id === "calendar")!;
      const execution = await repository.executeView(calendar);
      const identities = await repository.listSummaries({
        status: "all",
        limit: 50_000,
      });
      const start = new Date("2026-10-25T00:00:00Z");
      const end = new Date("2026-12-06T00:00:00Z");
      const samples = {
        calendarProjection: [] as number[],
        boardFirstPage: [] as number[],
      };
      for (let round = 0; round < 8; round++) {
        let since = performance.now();
        const entries = calendarEvents(
          execution,
          start,
          end,
          identities,
          {},
          configuration,
        );
        const { items } = calendarItems(
          entries,
          execution,
          "title",
          configuration,
        );
        if (round)
          samples.calendarProjection.push(
            Math.round(performance.now() - since),
          );
        expect(items.length).toBeGreaterThan(8000);
        since = performance.now();
        for await (const page of repository.iterateView(board, {
          cumulative: true,
        })) {
          if (round)
            samples.boardFirstPage.push(Math.round(performance.now() - since));
          expect(page.rows).toHaveLength(200);
          expect(page.totalCount).toBe(10_000);
          break;
        }
      }
      console.log(JSON.stringify(samples));
    } finally {
      vi.useRealTimers();
    }
  },
  180_000,
);
