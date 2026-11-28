import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

export function assertImportWorkspace({ app, importer, workspace, lock, pin }) {
  assert.ok(
    workspace.packages?.includes("apps/import"),
    "Importer must belong to the workspace",
  );
  assert.equal(importer.name, "tasknotes-import");
  assert.equal(
    app.dependencies["@mdbase-dev/sdk"],
    `file:vendor/${pin.artifact}`,
    "TaskNotes must retain its authenticated SDK original",
  );
  assert.equal(
    workspace.catalog["@mdbase-dev/sdk"],
    pin.version,
    "Importer SDK catalog must match the production original",
  );
  assert.equal(importer.dependencies["@mdbase-dev/sdk"], "catalog:");
  for (const pkg of [app, importer])
    assert.equal(
      pkg.dependencies["@tasknotes/model"],
      "catalog:",
      "Both apps must use the shared TaskNotes model catalog",
    );
  assert.match(
    workspace.catalog["@tasknotes/model"],
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/,
    "TaskNotes model must have an exact pin",
  );
  const version = workspace.catalog["@tasknotes/model"];
  const modelKey = `@tasknotes/model@${version}`;
  const patchPath = workspace.patchedDependencies?.[modelKey];
  const patch = lock.patchedDependencies?.[modelKey];
  assert.equal(patch?.path, patchPath, "Model patch must match the workspace");
  if (patch) assert.match(patch.hash, /^[a-f0-9]{64}$/);
  const lockedModel = patch ? `${version}(patch_hash=${patch.hash})` : version;
  for (const name of [".", "apps/import"]) {
    const model = lock.importers[name].dependencies["@tasknotes/model"];
    assert.equal(model.specifier, "catalog:");
    assert.equal(
      model.version,
      lockedModel,
      "Both apps must lock the same model",
    );
  }
  const sdk = lock.importers["apps/import"].dependencies["@mdbase-dev/sdk"];
  assert.equal(sdk.specifier, "catalog:");
  assert.equal(
    sdk.version,
    pin.version,
    "Importer must lock the production SDK version",
  );
  assert.equal(
    lock.packages[`@mdbase-dev/sdk@${pin.version}`]?.resolution.integrity,
    pin.sri,
    "Importer SDK must match the authenticated original bytes",
  );
}

export async function readImportWorkspace() {
  const read = (path) => readFile(new URL(path, root), "utf8");
  const json = async (path) => JSON.parse(await read(path));
  const app = await json("package.json");
  const trust = await json("vendor/production-trust.pin.json");
  return {
    app,
    importer: await json("apps/import/package.json"),
    workspace: parse(await read("pnpm-workspace.yaml")),
    lock: parse(await read("pnpm-lock.yaml")),
    pin: await json(`vendor/${trust.sdkPin}`),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assertImportWorkspace(await readImportWorkspace());
  console.log(
    "TaskNotes and importer share the authenticated SDK, model and workspace lock.",
  );
}
