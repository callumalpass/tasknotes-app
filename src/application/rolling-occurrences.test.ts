import { describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { todayString } from "../domain/task";
import { materializeRollingWindow } from "./rolling-occurrences";

function rollingTask() {
  const today = todayString();
  return new TaskNotesTaskModel().create(
    {
      title: "Rolling",
      scheduled: today,
      recurrence: `FREQ=DAILY;DTSTART=${today.replaceAll("-", "")}`,
      occurrenceMaterialization: "rolling",
      occurrenceFutureHorizon: "P2D",
    },
    { id: "series" },
  );
}

describe("rolling occurrence materialization", () => {
  it("reports individual secondary failures without losing later dates", async () => {
    const materialize = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockRejectedValueOnce("Rejected");
    const warnings = await materializeRollingWindow(rollingTask(), materialize);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(
      /rolling_occurrence_materialization_failed: .*: Unavailable/,
    );
    expect(warnings[1]).toMatch(
      /rolling_occurrence_materialization_failed: .*: Rejected/,
    );
    expect(materialize).toHaveBeenCalledTimes(3);
  });

  it("reports invalid horizons before attempting persistence", async () => {
    const materialize = vi.fn(async () => undefined);
    expect(
      await materializeRollingWindow(
        { ...rollingTask(), occurrenceFutureHorizon: "invalid" },
        materialize,
      ),
    ).toEqual([
      "rolling_occurrence_materialization_failed: invalid_occurrence_horizon: invalid is not a finite date duration.",
    ]);
    expect(materialize).not.toHaveBeenCalled();
  });
});
