import { describe, expect, it } from "vitest";

import {
  emptyReviewPromptState,
  parseReviewPromptState,
  recordCompletion,
  recordFirstUse,
  recordReviewRequested,
  type ReviewPromptState,
} from "./review-prompt";

const day = (date: string, time = "10:00") => new Date(`${date}T${time}:00`);

function completeOn(state: ReviewPromptState, ...dates: string[]) {
  let request = false;
  for (const date of dates)
    ({ state, request } = recordCompletion(state, day(date)));
  return { state, request };
}

describe("store review prompt rules", () => {
  const used = recordFirstUse(emptyReviewPromptState(), day("2026-11-01"));

  it("asks after completions on three days, four days after first use", () => {
    expect(
      completeOn(used, "2026-11-02", "2026-11-03", "2026-11-05").request,
    ).toBe(true);
  });

  it("does not ask on the first day of use", () => {
    const fresh = emptyReviewPromptState();
    const result = completeOn(fresh, "2026-11-01", "2026-11-01");
    expect(result.request).toBe(false);
    expect(result.state.firstUsed).toBe("2026-11-01");
  });

  it("counts distinct local days, not completions", () => {
    const result = completeOn(
      used,
      "2026-11-05",
      "2026-11-05",
      "2026-11-06",
      "2026-11-06",
    );
    expect(result.request).toBe(false);
    expect(result.state.completionDays).toEqual(["2026-11-05", "2026-11-06"]);
  });

  it("uses the local day, not the UTC day", () => {
    const late = recordCompletion(used, day("2026-11-05", "23:30")).state;
    expect(late.completionDays).toEqual(["2026-11-05"]);
  });

  it("waits until first use is at least four days ago", () => {
    expect(
      completeOn(used, "2026-11-02", "2026-11-03", "2026-11-04").request,
    ).toBe(false);
    expect(
      completeOn(used, "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05")
        .request,
    ).toBe(true);
  });

  it("waits 120 days after a request", () => {
    const { state } = completeOn(
      used,
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
    );
    const requested = recordReviewRequested(state, day("2026-11-05"));
    expect(completeOn(requested, "2026-11-06").request).toBe(false);
    expect(completeOn(requested, "2027-03-04").request).toBe(false);
    expect(completeOn(requested, "2027-03-05", "2027-03-06").request).toBe(
      true,
    );
  });

  it("keeps first use once recorded", () => {
    expect(recordFirstUse(used, day("2026-11-09")).firstUsed).toBe(
      "2026-11-01",
    );
  });

  it("keeps only the days it needs", () => {
    const { state } = completeOn(
      used,
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    );
    expect(state.completionDays).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
  });

  it("round trips stored state and ignores unusable values", () => {
    const state = recordReviewRequested(
      completeOn(used, "2026-11-02").state,
      day("2026-11-02"),
    );
    expect(parseReviewPromptState(JSON.stringify(state))).toEqual(state);
    expect(parseReviewPromptState(null)).toEqual(emptyReviewPromptState());
    expect(parseReviewPromptState("{")).toEqual(emptyReviewPromptState());
    expect(
      parseReviewPromptState(
        JSON.stringify({
          firstUsed: 3,
          completionDays: ["2026-11-02", "soon", 4],
          lastRequested: "yesterday",
        }),
      ),
    ).toEqual({ completionDays: ["2026-11-02"] });
  });
});
