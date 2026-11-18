import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Store workflows dispatched from main check out an older qualified build
// source over the workspace. Anything run from that tree afterwards comes from
// the source, which may predate the helper (mdbase-cloud-ops#2115). Release
// policy must follow the workflow commit; only build content follows the
// source.
const root = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_TOOLS = "$RUNNER_TEMP/workflow-tools/";

// Scripts deliberately read from the build source: they provision or build the
// application the source describes, exactly as the source's own CI did.
const BUILD_SOURCE_SCRIPTS = new Set(["scripts/ci/prefetch-java.mjs"]);

const nodeScriptCalls = (run) =>
  [
    ...String(run ?? "").matchAll(
      /\bnode\s+(?:--[\w-]+\s+)*"?([^\s"]*scripts\/[^\s"]+)"?/g,
    ),
  ].map((match) => match[1]);

// A source checkout under its own `path:` (deploy-tasknotes.yml) leaves the
// workflow tree in place; only one that replaces the workspace is at risk.
const isSourceCheckout = (step) =>
  step.uses?.startsWith("actions/checkout@") &&
  step.with?.ref === "${{ inputs.source_sha }}" &&
  step.with?.path === undefined;

async function sourceSwitchingJobs() {
  const dir = join(root, ".github/workflows");
  const jobs = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yml"))) {
    const workflow = parse(await readFile(join(dir, file), "utf8"));
    for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const checkout = steps.findIndex(isSourceCheckout);
      if (checkout >= 0) jobs.push({ file, name, steps, checkout });
    }
  }
  return jobs;
}

test("store builds switch to the qualified source in the expected jobs", async () => {
  const jobs = (await sourceSwitchingJobs()).map((j) => `${j.file}:${j.name}`);
  assert.deepEqual(jobs.sort(), [
    "android.yml:release",
    "ios-release.yml:release",
  ]);
});

test("helpers after the source checkout run from the workflow commit unless they build the source", async () => {
  for (const { file, name, steps, checkout } of await sourceSwitchingJobs()) {
    const where = `${file}:${name}`;
    const calls = steps
      .slice(checkout + 1)
      .flatMap((step) =>
        nodeScriptCalls(step.run).map((path) => ({ step: step.name, path })),
      );
    let usesTools = false;
    for (const { step, path } of calls) {
      if (path.startsWith(WORKFLOW_TOOLS)) {
        usesTools = true;
        const script = path.slice(WORKFLOW_TOOLS.length);
        assert.ok(
          existsSync(join(root, script)),
          `${where} "${step}" runs missing ${script}`,
        );
        continue;
      }
      assert.ok(
        BUILD_SOURCE_SCRIPTS.has(path),
        `${where} "${step}" runs ${path} from the build source; run workflow-owned helpers from ${WORKFLOW_TOOLS}scripts/ or classify it as build content`,
      );
    }
    if (!usesTools) continue;
    const keep = steps.findIndex((step) =>
      String(step.run ?? "").includes(
        'git archive "$GITHUB_WORKFLOW_SHA" scripts',
      ),
    );
    assert.ok(
      keep >= 0 && keep < checkout,
      `${where} keeps workflow helpers before the source checkout`,
    );
    assert.match(steps[keep].run, /tar -x -C "\$RUNNER_TEMP\/workflow-tools"/);
  }
});

test("workflow-owned helpers need nothing outside scripts/ and no installed packages", async () => {
  const builtins = new Set((await import("node:module")).builtinModules);
  const entries = new Set();
  for (const { steps, checkout } of await sourceSwitchingJobs())
    for (const step of steps.slice(checkout + 1))
      for (const path of nodeScriptCalls(step.run))
        if (path.startsWith(WORKFLOW_TOOLS))
          entries.add(join(root, path.slice(WORKFLOW_TOOLS.length)));

  const seen = new Set();
  const visit = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(join(root, "scripts"), file);
    assert.ok(!rel.startsWith(".."), `${file} is outside scripts/`);
    const text = await readFile(file, "utf8");
    // Static imports only: dynamic imports are reached by other commands.
    for (const [, spec] of text.matchAll(
      /^\s*(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)"/gms,
    )) {
      if (spec.startsWith(".")) await visit(join(dirname(file), spec));
      else
        assert.ok(
          spec.startsWith("node:") || builtins.has(spec),
          `${relative(root, file)} imports package ${spec}; workflow helpers run without an install`,
        );
    }
  };
  for (const entry of entries) await visit(entry);
  assert.ok(seen.size > 0);
});
