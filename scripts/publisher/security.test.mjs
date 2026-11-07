import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { createRequire } from "node:module";
const { parse } = createRequire(
  new URL("../../node_modules/@mdbase-dev/sdk/package.json", import.meta.url),
)("yaml");
import { productionPin } from "./originals.mjs";
import { assertEntryAsset, smoke } from "./smoke.mjs";
import { installTool } from "./tool.mjs";
import { verifyProvenanceBundle } from "./sdk-provenance.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = "abcdef123456" + "0".repeat(28);

it("passes identity policy in the DSSE second argument and refuses a wrong certificate identity", async () => {
  const identity =
    "https://github.com/mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml@refs/heads/main";
  // Model sigstore's overloaded API: a third argument is discarded for DSSE.
  const verify = async (bundle, options) => {
    if (
      options?.certificateIdentityURI &&
      bundle.identity !== options.certificateIdentityURI
    )
      throw Error("certificate identity refused");
    assert.equal(
      options.certificateIssuer,
      "https://token.actions.githubusercontent.com",
    );
    assert.equal(options.tlogThreshold, 1);
    assert.equal(options.ctLogThreshold, 1);
  };
  await verifyProvenanceBundle({ identity }, { identity }, verify);
  await assert.rejects(
    verifyProvenanceBundle(
      {
        identity:
          "https://github.com/other/repository/.github/workflows/publish.yml@refs/heads/main",
      },
      { identity },
      verify,
    ),
    /identity refused/,
  );
  const auth = await readFile(
    root + "scripts/publisher/authentication.mjs",
    "utf8",
  );
  assert.match(
    auth,
    /prove\s*=\s*provenSource/,
    "TaskNotes must use the same corrected live SDK verifier",
  );
});
it(
  "cryptographically refuses a real public npm bundle when its certificate identity differs from policy",
  { timeout: 120000 },
  async () => {
    const { pin } = await productionPin(root);
    const response = await fetch(pin.publication.attestations, {
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    assert.equal(response.ok, true);
    const proofs = (await response.json()).attestations.filter(
      (a) => a.predicateType === "https://slsa.dev/provenance/v1",
    );
    assert.equal(proofs.length, 1);
    const identity = `https://github.com/mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml@${pin.publication.ref}`;
    await verifyProvenanceBundle(proofs[0].bundle, { identity });
    await assert.rejects(
      verifyProvenanceBundle(proofs[0].bundle, {
        identity:
          "https://github.com/other/repo/.github/workflows/publish.yml@refs/heads/main",
      }),
      (error) => error.code === "UNTRUSTED_SIGNER_ERROR",
    );
  },
);
it("protected jobs only execute workflow-owned helpers, with ancestry checks before candidate data and upload", async () => {
  const { jobs } = parse(
    await readFile(root + ".github/workflows/deploy-tasknotes.yml", "utf8"),
  );
  for (const name of ["inputs", "publish", "production-recovery"]) {
    const job = jobs[name],
      checkout = job.steps.filter((s) =>
        s.uses?.startsWith("actions/checkout@"),
      );
    assert.equal(checkout[0].with.ref, "${{ github.sha }}");
    const ancestry = job.steps.findIndex((s) => s.run?.includes("refs.mjs"));
    if (name !== "production-recovery") assert.ok(ancestry > 0);
    for (const step of job.steps) {
      assert.notEqual(step["working-directory"], "candidate");
      assert.doesNotMatch(
        step.run ?? "",
        /(?:node|bash|source|import|cd)\s+[^\n]*candidate/,
      );
    }
    assert.notEqual(job.defaults?.run?.["working-directory"], "candidate");
    const candidate = job.steps.findIndex((s) => s.with?.path === "candidate");
    if (candidate >= 0) assert.ok(ancestry < candidate);
  }
  const deploy = jobs["publish"],
    upload = deploy.steps.find((s) => s.id === "upload");
  assert.match(upload.run, /refs\.mjs/);
  assert.equal(upload["timeout-minutes"], 7);
  assert.ok(
    deploy.steps
      .filter((step) => !step.run?.includes("runtime.mjs upload-config"))
      .every((step) => step["timeout-minutes"] > 0),
    "all protected preparation and publication steps have independent bounds",
  );
  assert.ok(
    deploy.steps.reduce((sum, step) => sum + step["timeout-minutes"], 0) <
      deploy["timeout-minutes"],
    "job deadline must outlive every step bound, including recovery and receipts",
  );
  for (const step of deploy.steps.filter((s) => s.id === "deployment")) {
    assert.match(step.if, /always\(\)/);
    assert.match(step.if, /upload.outcome == 'failure'/);
    assert.match(step.if, /upload.outcome == 'cancelled'/);
  }
  assert.doesNotMatch(JSON.stringify(deploy), /rollback\.mjs recover/);
  assert.equal(deploy.steps[0].run, 'test "$GITHUB_RUN_ATTEMPT" = 1');
  const point = deploy.steps.findIndex((s) =>
    s.with?.name?.startsWith("tasknotes-production-recovery-point-"),
  );
  assert.ok(
    point >= 0 && point < deploy.steps.indexOf(upload),
    "recovery point is stored before upload",
  );
  const smokeJob = jobs.smoke;
  assert.equal(smokeJob.environment, undefined);
  assert.doesNotMatch(JSON.stringify(smokeJob), /secrets\./);
  assert.ok(
    smokeJob.steps
      .filter((s) => s.uses?.startsWith("actions/checkout@"))
      .every((s) => s.with.ref === "${{ github.sha }}"),
  );
  assert.equal(smokeJob.needs, "publish");
  const recovery = jobs["production-recovery"];
  assert.match(recovery.if, /^always\(\)/);
  assert.match(recovery.if, /publish.result != 'skipped'/);
  assert.match(recovery.if, /needs\.smoke\.result != 'success'/);
  assert.doesNotMatch(recovery.if, /publish.result == 'success'/);
  assert.equal(
    recovery.steps
      .find((s) => s.run?.includes("rollback.mjs"))
      .run.match(/rollback\.mjs (\w+)/)[1],
    "recover",
  );
});
it("manual drill is default-off, cannot enter from ops bots or workflow_call, and fails only after upload and normal smoke", async () => {
  const workflow = parse(
      await readFile(root + ".github/workflows/deploy-tasknotes.yml", "utf8"),
    ),
    { jobs } = workflow;
  assert.equal(workflow.on.workflow_call, undefined);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.drill, {
    description:
      "Deliberately fail smoke after uploading the already-live production source (manual only).",
    type: "boolean",
    default: false,
  });
  const admission = jobs.admit.steps.find((s) =>
    s.run?.includes("drill.mjs admit"),
  );
  assert.equal(admission.env.DRILL, "${{ inputs.drill && 'true' || 'false' }}");
  assert.ok(
    admission.run.indexOf("refs.mjs") <
      admission.run.indexOf("drill.mjs admit"),
  );
  const upload = jobs.publish.steps.findIndex((s) => s.id === "upload"),
    check = jobs.publish.steps.findIndex((s) =>
      s.run?.includes("drill.mjs before-upload"),
    );
  assert.ok(check > 0 && check < upload);
  assert.equal(
    jobs.publish.steps[check].if,
    "inputs.drill && steps.compatibility.outputs.ready == 'true'",
  );
  const steps = jobs.smoke.steps,
    normal = steps.findIndex((s) => s.run?.includes("smoke.mjs")),
    fault = steps.findIndex((s) => s.run?.includes("drill.mjs fail"));
  assert.ok(fault > normal);
  assert.equal(
    steps[fault].if,
    "inputs.drill && inputs.target == 'production' && github.event_name == 'workflow_dispatch'",
  );
  assert.equal(steps[fault]["continue-on-error"], undefined);
  assert.ok(
    steps
      .slice(normal + 1, fault)
      .some((s) =>
        s.run?.includes(
          "tasknotes-receipt-production-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT",
        ),
      ),
  );
  assert.ok(
    steps.some(
      (s) =>
        s.if === "always() && inputs.drill" &&
        s.with?.path === "${{ runner.temp }}/tasknotes-drill.json",
    ),
  );
  const drill = await readFile(root + "scripts/publisher/drill.mjs", "utf8");
  assert.match(drill, /!env.GITHUB_ACTOR.endsWith\(["']\[bot\]["']\)/);
  assert.doesNotMatch(jobs["production-recovery"].if, /drill/);
});
for (const kind of ["publisher", "smoke"])
  it(`accepts the committed ${kind} lock and installs only with scripts disabled`, async () => {
    const base = await mkdtemp(join(tmpdir(), "editor-tool-test-"));
    try {
      const name = kind === "publisher" ? "wrangler" : "playwright";
      await assert.rejects(
        installTool(base, {
          kind,
          run(file, args, { cwd }) {
            assert.equal(file, "npm");
            assert.ok(args.includes("--ignore-scripts"));
            throw Error("install reached " + cwd.length);
          },
        }),
        /install reached/,
        name,
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
function browserDouble({
  pageError = false,
  fence = false,
  csp = false,
  entrySource = source,
  missingSignIn = false,
} = {}) {
  const listeners = {},
    events = [];
  const page = {
    on: (event, fn) => {
      listeners[event] = fn;
    },
    goto: async (url, options) => {
      events.push(url);
      assert.equal(options.waitUntil, "networkidle");
      if (pageError) listeners.pageerror(Error("private error never retained"));
      if (fence) listeners.console({ text: () => "readiness_fenced" });
      if (csp)
        listeners.console({
          text: () =>
            "Loading https://static.cloudflareinsights.com/beacon.min.js violates Content Security Policy",
        });
      return { status: () => 200 };
    },
    locator: (selector) =>
      selector === "#menu-button"
        ? {
            click: async () => {
              events.push("settings-opened");
            },
          }
        : selector === "body"
          ? { innerText: async () => "" }
          : {
              evaluateAll: async () => [
                `https://app.tasknotes.dev/assets/index-a1-${entrySource.slice(0, 12)}.js`,
                "https://app.tasknotes.dev/mdbase-shell-register.js",
                "https://static.cloudflareinsights.com/beacon.min.js/v1",
              ],
            },
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.equal(options.name, "Sign in");
      return {
        waitFor: async () => {
          if (missingSignIn) throw Error("not visible");
        },
      };
    },
  };
  const context = {
    newPage: async () => page,
    newCDPSession: async () => ({
      send: async (method, args) => {
        events.push(method);
        if (method.endsWith("setCacheDisabled"))
          assert.equal(args.cacheDisabled, true);
      },
    }),
    request: {
      get: async () => ({
        ok: () => true,
        body: async () => Buffer.from("entry"),
      }),
    },
  };
  return {
    events,
    chromium: {
      launch: async () => ({
        newContext: async (options) => {
          assert.equal(options.serviceWorkers, "block");
          assert.match(options.extraHTTPHeaders["Cache-Control"], /no-store/);
          return context;
        },
        close: async () => events.push("closed"),
      }),
    },
  };
}
it("smoke checks a fresh source-bound entry and sign-in, ignores beacon CSP console noise, but refuses page errors and fences", async () => {
  const good = browserDouble({ csp: true });
  assert.equal((await smoke(good.chromium, source)).ok, true);
  assert.ok(good.events.includes("Network.setCacheDisabled"));
  assert.ok(good.events.includes("closed"));
  assert.throws(
    () =>
      assertEntryAsset(
        "https://app.tasknotes.dev/assets/index-other.js",
        source,
      ),
    /source-mismatch/,
  );
  assert.doesNotThrow(() =>
    assertEntryAsset(
      `https://staging.tasknotes-app.pages.dev/assets/index-x-${source.slice(0, 12)}.js`,
      source,
      "staging",
    ),
  );
  assert.throws(
    () =>
      assertEntryAsset(
        `https://app.tasknotes.dev/assets/index-x-${source.slice(0, 12)}.js`,
        source,
        "staging",
      ),
    /source-mismatch/,
  );
  assert.throws(
    () =>
      assertEntryAsset(
        `https://app.tasknotes.dev/assets/index-x-${source.slice(0, 12)}.js`,
        source,
        "lab",
      ),
    /invalid-source/,
  );
  for (const options of [
    { pageError: true },
    { fence: true },
    { missingSignIn: true },
    { entrySource: "1".repeat(40) },
  ]) {
    const bad = browserDouble(options);
    await assert.rejects(smoke(bad.chromium, source));
    assert.ok(bad.events.includes("closed"));
  }
});
