import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  artifactJson,
  assertLinesOpen,
  gh,
  readSourceRun,
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

test("a store-line status read that never completes cancels the run and reports a read timeout", async () => {
  const queued = {
    path: ".github/workflows/tasknotes-store-line.yml",
    head_branch: "main",
    event: "workflow_dispatch",
    run_attempt: 1,
    status: "queued",
  };
  const make = (cancelFails) => {
    const calls = [];
    const transport = (path, options) => {
      calls.push([path, options]);
      if (path.endsWith("/dispatches")) return { workflow_run_id: 7 };
      if (path.endsWith("/cancel")) {
        if (cancelFails) throw new Error("release-evidence-unavailable");
        return {};
      }
      return queued;
    };
    return { transport, calls };
  };
  const readArtifact = async () => {
    throw new Error("artifact must not be read");
  };
  const wait = async () => {};
  for (const cancelFails of [false, true]) {
    const status = make(cancelFails);
    await assert.rejects(
      storeLine("android", "status", undefined, {
        transport: status.transport,
        readArtifact,
        wait,
      }),
      { message: "store-line-read-timeout" },
    );
    const cancels = status.calls.filter(([path]) => path.endsWith("/cancel"));
    assert.equal(cancels.length, 1);
    assert.match(cancels[0][0], /\/actions\/runs\/7\/cancel$/);
    assert.ok(cancels[0][1].body);
  }
  const stop = make(false);
  await assert.rejects(
    storeLine("android", "stop", "app-publication-failed", {
      transport: stop.transport,
      readArtifact,
      wait,
    }),
    { message: "store-line-outcome-unknown" },
  );
  assert.equal(
    stop.calls.filter(([path]) => path.endsWith("/cancel")).length,
    0,
  );
});

test("a GET retries a transient failure, then returns the parsed response", () => {
  const sleeps = [];
  let calls = 0;
  const exec = (_cmd, args) => {
    assert.ok(!args.includes("--method"));
    if (++calls < 3) throw new Error("HTTP 502: https://api.github.com/x");
    return '{"ok":true}';
  };
  assert.deepEqual(
    gh(`repos/${REPO}/actions/runs/5`, {}, false, {
      exec,
      sleep: (delay) => sleeps.push(delay),
    }),
    { ok: true },
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10000, 10000]);
});

test("an exhausted GET fails with the same bounded slug and names only the read", () => {
  for (const [path, read] of [
    [`repos/${REPO}/actions/runs/5`, "run-read"],
    [`repos/${REPO}/actions/runs/5/artifacts?per_page=100`, "artifacts-list"],
    [`repos/${REPO}/actions/runs/5/attempts/1/jobs?per_page=100`, "jobs-read"],
    [
      `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=a&per_page=100`,
      "runs-list",
    ],
    [`repos/${REPO}/compare/a...main?per_page=1`, "compare-read"],
    [`repos/${OPS}/contents/config/client-apps.json?ref=main`, "policy-read"],
  ]) {
    let calls = 0;
    const sleeps = [];
    assert.throws(
      () =>
        gh(path, {}, false, {
          exec: () => {
            calls++;
            throw new Error("secret stderr with token ghp_x and a body");
          },
          sleep: (delay) => sleeps.push(delay),
        }),
      (error) => {
        assert.equal(error.message, "release-evidence-unavailable");
        assert.equal(error.read, read);
        assert.ok(!JSON.stringify(error).includes("ghp_"));
        return true;
      },
    );
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [10000, 10000]);
  }
});

test("a POST is a write and is never retried", () => {
  let calls = 0;
  const sleeps = [];
  assert.throws(
    () =>
      gh(
        `repos/${REPO}/actions/workflows/android.yml/dispatches`,
        { body: { ref: "main" } },
        false,
        {
          exec: (_cmd, args) => {
            assert.ok(args.includes("POST"));
            calls++;
            throw new Error("HTTP 502");
          },
          sleep: (delay) => sleeps.push(delay),
        },
      ),
    (error) => {
      assert.equal(error.message, "release-evidence-unavailable");
      assert.equal(error.read, undefined);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

const sourceRun = {
  id: 9,
  path: ".github/workflows/android.yml",
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: "a".repeat(40),
};

test("a source run read stale at the completion boundary is re-read until it settles", async () => {
  const views = [
    { ...sourceRun, status: "in_progress", conclusion: null },
    { ...sourceRun, conclusion: null },
    sourceRun,
  ];
  const waits = [];
  const paths = [];
  const run = await readSourceRun("android", 9, {
    transport: (path) => {
      paths.push(path);
      return views.shift();
    },
    wait: async (delay) => waits.push(delay),
  });
  assert.equal(run, sourceRun);
  assert.deepEqual(paths, Array(3).fill(`repos/${REPO}/actions/runs/9`));
  assert.deepEqual(waits, [10000, 10000]);
});

test("a source run that never settles refuses after the bounded re-reads", async () => {
  for (const view of [
    { ...sourceRun, status: "in_progress", conclusion: null },
    { ...sourceRun, conclusion: "failure" },
  ]) {
    let calls = 0;
    const waits = [];
    await assert.rejects(
      readSourceRun("android", 9, {
        transport: () => (calls++, view),
        wait: async (delay) => waits.push(delay),
      }),
      { message: "trusted-successful-source-run-required" },
    );
    assert.equal(calls, 3);
    assert.deepEqual(waits, [10000, 10000]);
  }
});

test("a source run identity mismatch refuses at once without a re-read", async () => {
  for (const view of [
    { ...sourceRun, path: ".github/workflows/ios-release.yml" },
    { ...sourceRun, repository: { full_name: "someone/else" } },
    { ...sourceRun, head_repository: { full_name: "someone/else" } },
    { ...sourceRun, event: "push" },
    { ...sourceRun, head_branch: "feature" },
    { ...sourceRun, run_attempt: 2 },
    { ...sourceRun, head_sha: "main" },
    { ...sourceRun, event: "push", status: "in_progress", conclusion: null },
  ]) {
    let calls = 0;
    const waits = [];
    await assert.rejects(
      readSourceRun("android", 9, {
        transport: () => (calls++, view),
        wait: async (delay) => waits.push(delay),
      }),
      { message: "trusted-successful-source-run-required" },
    );
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  }
});
