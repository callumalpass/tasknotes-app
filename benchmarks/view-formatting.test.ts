import { expect, it } from "vitest";
import { demoTasks } from "../src/demo/demo-tasks";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import {
  viewPropertyDetails,
  relativeDateDetail,
} from "../src/i18n/view-presentation";
it.runIf(process.env.TASKNOTES_BENCH_FORMATTING === "1")(
  "measures localized list and calendar property presentation",
  () => {
    const model = new TaskNotesTaskModel({ timezone: "Australia/Melbourne" });
    const config = model.configuration();
    const rows = demoTasks(model, 10000).map((task) => ({ task, values: {} }));
    const properties = ["scheduled", "due", "priority", "status"].map(
      (key) => ({ key }),
    );
    for (const size of [1000, 10000]) {
      const times = [];
      let count = 0;
      for (let round = 0; round < 8; round++) {
        const start = performance.now();
        count = 0;
        for (let i = 0; i < size; i++) {
          const row = rows[i];
          const details = viewPropertyDetails(row, properties) ?? [];
          for (const detail of details)
            if (relativeDateDetail(detail, row.task, config).value) count++;
        }
        if (round) times.push(performance.now() - start);
      }
      expect(count).toBeGreaterThan(size);
      console.log(
        JSON.stringify({
          size,
          count,
          times,
          median: [...times].sort((a, b) => a - b)[3],
        }),
      );
    }
  },
  180000,
);
