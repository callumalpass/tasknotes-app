import test from "node:test";
import assert from "node:assert/strict";
import { generatedMetadata } from "./submit-app-store.mjs";
test("new versions get notes without inventing feature/privacy claims or needing a human", () => {
  const result = generatedMetadata(
    {
      copyright: "2026 Example",
      whatsNew: { "en-AU": "Old features", "fr-FR": "Old features" },
      reviewNotes:
        "TaskNotes 1.0.12\n\nHOW TO REVIEW\nUse the review account.\nWHAT CHANGED\nOld promises.\nWHAT THE APP DOES\nOld descriptions.",
    },
    "1.0.13",
  );
  assert.equal(result.version, "1.0.13");
  assert.deepEqual(result.whatsNew, {
    "en-AU": "TaskNotes 1.0.13.",
    "fr-FR": "TaskNotes 1.0.13.",
  });
  assert.ok(result.reviewNotes.includes("Use the review account."));
  assert.ok(!result.reviewNotes.includes("Old promises"));
  assert.equal(result.releaseType, "AFTER_APPROVAL");
});
