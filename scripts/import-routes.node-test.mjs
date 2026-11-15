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
import { test } from "node:test";

test("main app serves import and exact Todoist callback without redirecting OAuth parameters", async () => {
  const root = await mkdtemp(join(tmpdir(), "tasknotes-import-routes-"));
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist/index.html"), "[test] app shell");
    await copyFile(
      new URL("./write-static-routes.mjs", import.meta.url),
      join(root, "scripts/write-static-routes.mjs"),
    );
    execFileSync(
      process.execPath,
      [join(root, "scripts/write-static-routes.mjs")],
      { env: { ...process.env, VITE_BASE_PATH: "/" } },
    );
    const redirects = await readFile(join(root, "dist/_redirects"), "utf8");
    assert.ok(redirects.includes("/import / 200\n"));
    assert.ok(redirects.includes("/import/todoist/callback / 200\n"));
    assert.ok(redirects.includes("/auth/mdbase/callback / 200\n"));
    assert.equal(
      await readFile(join(root, "dist/import/todoist/callback.html"), "utf8"),
      "[test] app shell",
    );
    assert.equal(
      await readFile(join(root, "dist/import/index.html"), "utf8"),
      "[test] app shell",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
