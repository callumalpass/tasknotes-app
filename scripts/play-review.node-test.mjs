import test from "node:test";
import assert from "node:assert/strict";
import { playReviewBlock } from "./store-status.mjs";
test("release lifecycle, not track completed, controls review and rejection", () => {
  const status = {
    live: [{ versionCodes: ["123"] }],
    review: {
      available: true,
      releases: [
        {
          track: "production",
          state: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
          versionCodes: ["123"],
        },
      ],
    },
  };
  assert.equal(playReviewBlock(status), null);
  for (const state of [
    "DRAFT",
    "IN_REVIEW",
    "NOT_SENT_FOR_REVIEW",
    "APPROVED_NOT_PUBLISHED",
  ]) {
    const s = structuredClone(status);
    s.review.releases.push({
      track: "custom-closed",
      state: "RELEASE_LIFECYCLE_STATE_" + state,
      versionCodes: ["124"],
    });
    assert.equal(playReviewBlock(s), "earlier-store-version-in-flight");
  }
  const rejected = structuredClone(status);
  rejected.review.releases[0].state = "RELEASE_LIFECYCLE_STATE_NOT_APPROVED";
  assert.equal(playReviewBlock(rejected), "store-rejected");
  for (const s of [
    { ...status, review: undefined },
    { ...status, review: { available: false } },
    { ...status, review: { available: true, releases: [] } },
    { ...status, review: { available: true, releases: [{ state: "future" }] } },
  ])
    assert.equal(
      playReviewBlock(s),
      "play-release-lifecycle-observer-unavailable",
    );
});
