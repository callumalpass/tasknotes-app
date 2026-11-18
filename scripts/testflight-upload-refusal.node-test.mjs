import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  UPLOAD_REFUSED,
  uploadRefusal,
  uploadRefusalClass,
  uploadRefusalReason,
} from "./testflight-upload-refusal.mjs";

// Synthetic identifiers in the shape altool prints; none may leave the runner.
const secrets = [
  "ABCDE12345",
  "00000000-1111-2222-3333-444444444444",
  "reviewer@example.invalid",
  "TaskNotes.ipa",
];
const noise = `Delivery UUID: ${secrets[1]}\nTeam ${secrets[0]} ${secrets[2]} ${secrets[3]}\n`;

test("classifies known altool refusals into fixed reasons", () => {
  const cases = [
    [
      "ERROR: [ContentDelivery.Uploader] ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE \"The bundle version must be higher than the previously uploaded version: '42'.\"",
      "testflight-build-number-duplicate",
    ],
    [
      "Redundant Binary Upload. You've already uploaded a build",
      "testflight-build-number-duplicate",
    ],
    [
      "ERROR ITMS-90186: \"Invalid Pre-Release Train. The train version '1.0.24' is closed for new build submissions\"",
      "testflight-version-train-closed",
    ],
    [
      'ERROR ITMS-90062: "This bundle is invalid. The value for key CFBundleShortVersionString [1.0.24] must contain a higher version than that of the previously approved version [1.0.24]."',
      "testflight-version-train-closed",
    ],
    ["ERROR ITMS-90382: Upload limit reached.", "testflight-upload-limit"],
    [
      "FORBIDDEN_ERROR: A required agreement is missing or has expired.",
      "testflight-agreement-required",
    ],
    [
      "NOT_AUTHORIZED Authentication credentials are missing or invalid. (HTTP 401)",
      "testflight-auth-refused",
    ],
    [
      "Failed to upload: status code 503 Service Unavailable",
      "testflight-service-unavailable",
    ],
    [
      "NSURLErrorDomain Code=-1001 The request timed out.",
      "testflight-transport",
    ],
    [
      'ERROR ITMS-90717: "Invalid App Store Icon."',
      "testflight-validation-itms-90717",
    ],
    ["Something new went wrong", "testflight-upload-unclassified"],
  ];
  for (const [log, reason] of cases)
    assert.equal(uploadRefusalClass(noise + log, "1"), reason, log);
  assert.equal(
    uploadRefusalClass(undefined, "1"),
    "testflight-upload-log-missing",
  );
  // altool exited 0 but App Store Connect never listed the build.
  assert.equal(
    uploadRefusalClass("UPLOAD FINISHED", "0"),
    "testflight-build-not-visible",
  );
});

test("numbers in identifiers or sizes do not look like HTTP failures", () => {
  assert.equal(
    uploadRefusalClass("Uploaded 401 of 503 packages; build 500", "1"),
    "testflight-upload-unclassified",
  );
});

test("the receipt is bound to the exact build run and fixed reasons only", () => {
  const receipt = uploadRefusal("testflight-upload-limit", 44);
  assert.deepEqual(receipt, {
    outcome: UPLOAD_REFUSED,
    reason: "testflight-upload-limit",
    run_id: 44,
  });
  assert.equal(uploadRefusalReason(receipt, 44), "testflight-upload-limit");
  assert.equal(uploadRefusalReason(receipt, 45), null);
  assert.equal(uploadRefusalReason({ ...receipt, detail: "x" }, 44), null);
  assert.equal(
    uploadRefusalReason({ ...receipt, reason: "Upload limit reached" }, 44),
    null,
  );
  assert.equal(
    uploadRefusalReason({ ...receipt, outcome: "submitted" }, 44),
    null,
  );
  assert.equal(uploadRefusalReason(null, 44), null);
  assert.throws(() => uploadRefusal("raw Apple message", 44));
  assert.throws(() => uploadRefusal("testflight-upload-limit", 0));
});

test("the iOS release keeps the upload log private and retains the refusal class", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/ios-release.yml", import.meta.url),
      "utf8",
    ),
  );
  const steps = workflow.jobs.release.steps;
  const upload = steps.findIndex(
    (step) => step.name === "Upload to TestFlight",
  );
  assert.equal(steps[upload].id, "testflight");
  const run = steps[upload].run;
  assert.match(run, /> "\$upload_log" 2>&1/);
  // App Store Connect, not the altool wording, decides success.
  assert.match(
    run,
    /node "\$RUNNER_TEMP\/workflow-tools\/scripts\/testflight-upload\.mjs" confirm "\$upload_log" "\$upload_status"\n/,
  );
  assert.doesNotMatch(run, /No errors uploading|\|\| true/);
  const preflight = steps.findIndex((step) => step.id === "build_number");
  assert.ok(preflight > 0 && preflight < upload);
  assert.equal(
    steps[preflight].run,
    'node "$RUNNER_TEMP/workflow-tools/scripts/testflight-upload.mjs" preflight',
  );
  assert.ok(
    preflight <
      steps.findIndex((step) => step.name === "Install Apple signing identity"),
  );
  // The raw log is never printed or uploaded.
  assert.doesNotMatch(run, /cat "\$upload_log"|tail [^\n]*upload_log/);
  const retained = steps.filter(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact@") &&
      step.with?.name === "testflight-upload-result",
  );
  assert.equal(retained.length, 1);
  assert.equal(steps.indexOf(retained[0]), upload + 1);
  assert.equal(retained[0].with.path, "testflight-upload-result.json");
  assert.equal(
    retained[0].if,
    "failure() && (steps.testflight.outcome == 'failure' || steps.build_number.outcome == 'failure') && hashFiles('testflight-upload-result.json') != ''",
  );
  for (const step of steps.filter((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  ))
    assert.doesNotMatch(String(step.with?.path), /testflight-upload\.log/);
});
