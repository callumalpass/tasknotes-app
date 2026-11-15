import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

test("serves the original SDK native assets and compiles WASM under the Pages CSP without account access", async ({
  page,
  request,
}) => {
  const pins = JSON.parse(
    await readFile(
      "node_modules/@mdbase-dev/sdk/dist/application/asset-pins.json",
      "utf8",
    ),
  );
  const assets = await readdir("dist/assets");
  const runtime = assets.find((name) => /^runtime-.*\.wasm$/.test(name))!;
  const sqlite = assets.find((name) => /^sqlite3-.*\.wasm$/.test(name))!;
  const worker = assets.find((name) => /^worker-.*\.js$/.test(name))!;
  expect((await request.get(`/assets/${worker}`)).ok()).toBe(true);
  for (const [name, expected] of [
    [runtime, pins.runtime.sha256],
    [sqlite, pins.sqlite.sha256],
  ]) {
    const response = await request.get(`/assets/${name}`);
    expect(response.ok()).toBe(true);
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(expected);
  }
  const headers = await readFile("public/_headers", "utf8");
  const csp = headers.match(/Content-Security-Policy: (.+)/)![1];
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.goto("/");
  const result = await page.evaluate(async (runtime) => {
    const module = await WebAssembly.compile(
      await (await fetch(`/assets/${runtime}`)).arrayBuffer(),
    );
    return module instanceof WebAssembly.Module;
  }, runtime);
  expect(result).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
