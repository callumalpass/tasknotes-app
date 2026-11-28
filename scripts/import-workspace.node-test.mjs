import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "yaml";
import {
  assertImportWorkspace,
  readImportWorkspace,
} from "./check-import-workspace.mjs";

const root = new URL("../", import.meta.url);

test("both apps use one model and the same authenticated production SDK publication", async () => {
  assertImportWorkspace(await readImportWorkspace());
  const files = await readdir(new URL("apps/import/", root));
  assert.ok(!files.includes("package-lock.json"));
  assert.ok(!files.includes("pnpm-lock.yaml"));
  assert.ok(!files.includes("vendor"));
});

test("a coordinated exact prerelease model pin is permitted", async () => {
  const input = await readImportWorkspace();
  const version = "0.3.1-rc.1";
  input.workspace.catalog["@tasknotes/model"] = version;
  for (const name of [".", "apps/import"])
    input.lock.importers[name].dependencies["@tasknotes/model"].version =
      version;
  assertImportWorkspace(input);
});

test("SDK version, bytes, catalog and model drift fail closed", async () => {
  for (const change of [
    (input) => {
      input.workspace.catalog["@mdbase-dev/sdk"] = "0.1.0-beta.1";
    },
    (input) => {
      input.lock.importers["apps/import"].dependencies[
        "@tasknotes/model"
      ].version = input.workspace.catalog["@tasknotes/model"];
    },
    (input) => {
      input.app.dependencies["@mdbase-dev/sdk"] = "latest";
    },
    (input) => {
      input.importer.dependencies["@mdbase-dev/sdk"] = "0.1.0-beta.218";
    },
    (input) => {
      input.importer.dependencies["@tasknotes/model"] = "0.3.0";
    },
    (input) => {
      input.workspace.catalog["@tasknotes/model"] = "^0.3.0";
    },
    (input) => {
      input.lock.importers["apps/import"].dependencies[
        "@tasknotes/model"
      ].version = "0.2.0";
    },
    (input) => {
      input.lock.importers["apps/import"].dependencies[
        "@mdbase-dev/sdk"
      ].version = "0.1.0-beta.1";
    },
    (input) => {
      input.lock.packages[
        `@mdbase-dev/sdk@${input.pin.version}`
      ].resolution.integrity = "sha512-changed";
    },
  ]) {
    const input = await readImportWorkspace();
    change(input);
    assert.throws(() => assertImportWorkspace(input));
  }
});

test("the canonical catalog loader works from either app's working directory", () => {
  const script = new URL("scripts/canonical-task-pack.mjs", root).href;
  const code = `const { loadCanonicalTaskNotesTypePack } = await import(${JSON.stringify(script)}); console.log((await loadCanonicalTaskNotesTypePack()).manifest.version);`;
  for (const directory of [root, new URL("apps/import/", root)])
    assert.equal(
      execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
        cwd: fileURLToPath(directory),
        encoding: "utf8",
      }).trim(),
      "0.3.0-rc.23",
    );
});

test("legacy shell suites stay isolated while the app and native builds consume the import engine", async () => {
  const vite = await readFile(new URL("vite.config.ts", root), "utf8");
  const eslint = await readFile(new URL("eslint.config.js", root), "utf8");
  assert.ok(vite.includes('"**/apps/**"'));
  assert.ok(eslint.includes('"apps"'));
  const { app, importer } = await readImportWorkspace();
  assert.equal(app.dependencies["tasknotes-import"], "workspace:*");
  assert.deepEqual(Object.keys(importer.exports).sort(), [
    "./authorization",
    "./plan",
    "./storage/task-repository",
    "./task-repository",
    "./todoist",
  ]);
  for (const name of ["android.yml", "ios.yml"]) {
    const workflow = parse(
      await readFile(new URL(`.github/workflows/${name}`, root), "utf8"),
    );
    assert.ok(
      !(workflow.on.pull_request["paths-ignore"] ?? []).includes(
        "apps/import/**",
      ),
    );
    assert.equal(workflow.on.push["paths-ignore"], undefined);
  }
});

test("import verification stays required without introducing a second publisher", async () => {
  const workflows = await readdir(new URL(".github/workflows/", root));
  assert.ok(!workflows.includes("importer-deploy.yml"));
  assert.ok(workflows.includes("deploy-tasknotes.yml"));
  const ci = parse(
    await readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
  );
  assert.equal(ci.on.pull_request, null);
  assert.ok(
    ci.jobs["importer-verify"].steps.some(
      (step) => step.run === "pnpm import:check",
    ),
  );
  assert.ok(
    ci.jobs["importer-verify"].steps.some(
      (step) => step.run === "pnpm import:test:e2e",
    ),
  );
});

test("importer UI routes collection discovery, writes and recovery through TaskRepository", async () => {
  for (const path of ["apps/import/src/App.tsx", "src/app/import-screen.tsx"]) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /\.records\b|\.awaitReceipt\(|\.ledger\b/);
    assert.match(source, /\.importTasks\(/);
    assert.match(source, /\.recoverWrites\(/);
  }
});
