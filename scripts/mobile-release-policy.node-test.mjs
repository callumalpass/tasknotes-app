import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  artifactJson,
  assertLinesOpen,
  storeLine,
  latestExactGreen,
  qualifyChecks,
  requiredChecks,
  OPS,
  REPO,
  LINES,
} from "./mobile-release-policy.mjs";

test("exact CI cannot borrow success from an old attempt or other event", () => {
  const run = {
    id: 1,
    head_sha: "a",
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ios.yml",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
  };
  assert.equal(latestExactGreen([run], "a", "ios.yml"), true);
  assert.equal(
    latestExactGreen(
      [run, { ...run, run_attempt: 2, conclusion: "failure" }],
      "a",
      "ios.yml",
    ),
    false,
  );
  assert.equal(
    latestExactGreen([{ ...run, event: "pull_request" }], "a", "ios.yml"),
    false,
  );
});

const storeChecks = {
  "google-play": [{ workflow: "ci.yml" }, { workflow: "android.yml" }],
  "app-store": [{ workflow: "ci.yml" }, { workflow: "ios.yml" }],
};
function policyTransport(checks = storeChecks, runsFor = () => undefined) {
  const calls = [];
  const transport = (path, options, evidence) => {
    calls.push({ path, evidence });
    if (path === `repos/${OPS}/contents/config/client-apps.json?ref=main`) {
      assert.equal(evidence, true);
      const content = JSON.stringify([
        { repository: REPO, store_checks: checks },
      ]);
      return {
        encoding: "base64",
        size: Buffer.byteLength(content),
        content: Buffer.from(content).toString("base64"),
      };
    }
    const workflow = path.match(/\/workflows\/([^/]+)\/runs/)[1];
    assert.ok(path.includes("head_sha=source&branch=main&event=push"));
    return {
      workflow_runs: runsFor(workflow) ?? [
        {
          id: 1,
          run_attempt: 1,
          head_sha: "source",
          event: "push",
          head_branch: "main",
          path: `.github/workflows/${workflow}`,
          status: "completed",
          conclusion: "success",
        },
      ],
    };
  };
  return { transport, calls };
}

test("dispatch gate reads the single ops target policy, never a local check list", () => {
  for (const [platform, target] of [
    ["android", "google-play"],
    ["ios", "app-store"],
  ]) {
    const { transport, calls } = policyTransport();
    assert.deepEqual(requiredChecks(platform, transport), storeChecks[target]);
    qualifyChecks("source", platform, transport);
    const workflows = calls.filter(({ path }) => path.includes("/workflows/"));
    assert.equal(workflows.length, 2);
    assert.ok(
      workflows.every(({ path }, index) =>
        path.includes(`/workflows/${storeChecks[target][index].workflow}/`),
      ),
    );
  }
  const changedPolicy = {
    ...storeChecks,
    "google-play": [
      { workflow: "ci.yml" },
      { workflow: "new-platform-check.yml" },
    ],
  };
  const { transport, calls } = policyTransport(changedPolicy);
  qualifyChecks("source", "android", transport);
  assert.ok(
    calls.some(({ path }) => path.includes("/new-platform-check.yml/")),
  );
  assert.ok(!calls.some(({ path }) => path.includes("/android.yml/")));
});

test("missing or invalid ops policy fails closed without fallback", () => {
  for (const checks of [
    {},
    { "google-play": [] },
    { "google-play": [{ workflow: "android.yml" }] },
    { "google-play": [{ workflow: "ci.yml" }, { workflow: "ci.yml" }] },
    { "google-play": [{ workflow: "ci.yml" }, { workflow: "../other.yml" }] },
    { "google-play": [{ workflow: "ci.yml", jobs: [] }] },
    { "google-play": [{ workflow: "ci.yml", jobs: ["Build", "Build"] }] },
  ]) {
    assert.throws(
      () => requiredChecks("android", policyTransport(checks).transport),
      /store-check-policy-required/,
    );
  }
  assert.throws(
    () => requiredChecks("other", policyTransport().transport),
    /invalid-store-platform/,
  );
});

test("each target check needs the newest completed green main push attempt", () => {
  for (const platform of ["android", "ios"]) {
    const checks =
      platform === "android"
        ? storeChecks["google-play"]
        : storeChecks["app-store"];
    for (const { workflow: check } of checks) {
      const first = {
        id: 9,
        run_attempt: 1,
        head_sha: "source",
        event: "push",
        head_branch: "main",
        path: `.github/workflows/${check}`,
        status: "completed",
        conclusion: "cancelled",
      };
      const green = { ...first, run_attempt: 2, conclusion: "success" };
      const fixture = (runs) =>
        policyTransport(storeChecks, (workflow) =>
          workflow === check ? runs : undefined,
        ).transport;
      assert.doesNotThrow(() =>
        qualifyChecks("source", platform, fixture([green, first])),
      );
      for (const changes of [
        { status: "in_progress" },
        { conclusion: "failure" },
        { conclusion: "cancelled" },
        { event: "pull_request" },
        { head_branch: "other" },
        { head_sha: "other" },
        { path: ".github/workflows/other.yml" },
      ]) {
        assert.throws(
          () =>
            qualifyChecks(
              "source",
              platform,
              fixture([first, { ...green, ...changes }]),
            ),
          /exact-main-ci-required/,
        );
      }
      assert.throws(
        () => qualifyChecks("source", platform, fixture([])),
        /exact-main-ci-required/,
      );
      assert.throws(
        () =>
          qualifyChecks(
            "source",
            platform,
            fixture([
              green,
              { ...green, run_attempt: 3, conclusion: "failure" },
            ]),
          ),
        /exact-main-ci-required/,
      );
    }
  }
});

test("store holds cannot address a server line or each other", () => {
  assert.deepEqual(LINES, {
    android: "tasknotes-google-play",
    ios: "tasknotes-app-store",
  });
});

test("optional named jobs must succeed in the selected run attempt", () => {
  const policy = {
    "google-play": [
      { workflow: "ci.yml", jobs: ["Lint", "Build production extension"] },
    ],
  };
  const jobs = policy["google-play"][0].jobs.map((name) => ({
    name,
    run_id: 1,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
  }));
  const fixture = (values) => {
    const base = policyTransport(policy, () => [
      {
        id: 1,
        run_attempt: 2,
        head_sha: "source",
        event: "push",
        head_branch: "main",
        path: ".github/workflows/ci.yml",
        status: "completed",
        conclusion: "success",
      },
    ]).transport;
    return (path, ...args) => {
      if (path.includes("/jobs?")) {
        assert.ok(path.includes("/runs/1/attempts/2/jobs?"));
        return { jobs: values };
      }
      return base(path, ...args);
    };
  };
  assert.doesNotThrow(() => qualifyChecks("source", "android", fixture(jobs)));
  for (const changes of [
    { run_id: 9 },
    { run_attempt: 1 },
    { status: "in_progress" },
    { conclusion: "skipped" },
    { conclusion: "failure" },
  ]) {
    assert.throws(
      () =>
        qualifyChecks(
          "source",
          "android",
          fixture([jobs[0], { ...jobs[1], ...changes }]),
        ),
      /exact-main-ci-required/,
    );
  }
  for (const values of [jobs.slice(0, 1), [...jobs, jobs[1]]]) {
    assert.throws(
      () => qualifyChecks("source", "android", fixture(values)),
      /exact-main-ci-required/,
    );
  }
});

test("the Actions-only bridge checks target and whole-app stops without an Issues grant", async () => {
  await assertLinesOpen("android", async () => ({
    stopped: false,
    app_stopped: false,
  }));
  for (const state of [
    { stopped: true, app_stopped: false },
    { stopped: false, app_stopped: true },
    { stopped: false },
  ]) {
    await assert.rejects(assertLinesOpen("android", async () => state));
  }
});

test("artifact reads retry a transient download, then fail with a bounded slug", async () => {
  const waits = [];
  let calls = 0;
  const flaky = (_cmd, args) => {
    if (++calls < 3) throw new Error("Command failed: gh run download");
    writeFileSync(
      join(args[args.indexOf("--dir") + 1], "x.json"),
      '{"ok":true}',
    );
  };
  const wait = async (delay) => waits.push(delay);
  assert.deepEqual(
    await artifactJson(1, "x", "x.json", REPO, false, {
      download: flaky,
      wait,
    }),
    { ok: true },
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10000, 10000]);
  calls = 0;
  await assert.rejects(
    artifactJson(1, "x", "x.json", REPO, false, {
      download: () => {
        calls++;
        throw new Error("Command failed: gh run download");
      },
      wait,
    }),
    { message: "release-evidence-unavailable" },
  );
  assert.equal(calls, 3);
});

test("a store-line read tolerates a just-dispatched run that is briefly unreadable", async () => {
  const run = {
    path: ".github/workflows/tasknotes-store-line.yml",
    head_branch: "main",
    event: "workflow_dispatch",
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
  };
  const make = (failures) => {
    let reads = 0;
    const transport = (path) => {
      if (path.endsWith("/dispatches")) return { workflow_run_id: 7 };
      if (++reads <= failures) throw new Error("release-evidence-unavailable");
      return run;
    };
    return { transport, reads: () => reads };
  };
  const readArtifact = async () => ({
    app: LINES.android,
    stopped: false,
    app_stopped: false,
  });
  const wait = async () => {};
  const flaky = make(2);
  assert.deepEqual(
    await storeLine("android", "status", undefined, {
      transport: flaky.transport,
      readArtifact,
      wait,
    }),
    { app: LINES.android, stopped: false, app_stopped: false },
  );
  assert.equal(flaky.reads(), 3);
  const down = make(Infinity);
  await assert.rejects(
    storeLine("android", "status", undefined, {
      transport: down.transport,
      readArtifact,
      wait,
    }),
    { message: "release-evidence-unavailable" },
  );
  assert.equal(down.reads(), 8);
});
