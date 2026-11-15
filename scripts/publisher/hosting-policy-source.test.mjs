// The publisher refuses any _headers or _redirects that differs from its reviewed
// policy. Keep the policy and the source in step so a route or header change is
// caught here, not at publication.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("reviewed _redirects policy matches the generated routes", async () => {
  const source = await readFile(
    join(root, "scripts", "write-static-routes.mjs"),
    "utf8",
  );
  const list =
    /function pagesRedirects\(\) \{\s*const routes = \[([\s\S]*?)\];/.exec(
      source,
    );
  assert.ok(list, "pagesRedirects route list not found");
  const routes = [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(
    routes.map((route) => `${route} / 200\n`).join(""),
    redirectsPolicy,
  );
});
