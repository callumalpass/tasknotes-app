// The publisher refuses any _headers or _redirects that differs from its reviewed
// policy. Keep the policy and the source in step so a route or header change is
// caught here, not at publication.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { headersPolicy, redirectsPolicy } from "./hosting-policy.mjs";

const root = join(import.meta.dirname, "..", "..");

test("reviewed _headers policy matches public/_headers", async () => {
  assert.equal(
    await readFile(join(root, "public", "_headers"), "utf8"),
    headersPolicy,
  );
});

test("generated Pages routes serve both offline HTML assets directly and match the reviewed policy", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tasknotes-pages-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  await mkdir(join(dir, "scripts"));
  await mkdir(join(dir, "dist"));
  await writeFile(join(dir, "dist/index.html"), "shell");
  const generator = join(dir, "scripts/write-static-routes.mjs");
  await copyFile(join(root, "scripts/write-static-routes.mjs"), generator);
  execFileSync(process.execPath, [generator], {
    env: { ...process.env, VITE_BASE_PATH: "/" },
  });
  const routes = await readFile(join(dir, "dist/_redirects"), "utf8");
  assert.match(routes, /^\/index\.html \/ 200$/m);
  assert.match(routes, /^\/404\.html \/404 200$/m);
  assert.equal(routes, redirectsPolicy);
});
