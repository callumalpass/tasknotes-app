import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadConfigFromFile } from "vite";

async function viteConfiguration(environment) {
  const { config } = await loadConfigFromFile(
    environment,
    resolve(import.meta.dirname, "../vite.config.ts"),
  );
  return config;
}

async function manifestAliases(environment) {
  return (await viteConfiguration(environment)).resolve.alias;
}

for (const mode of ["development", "e2e"]) {
  test(`aliases only dev-server imports in ${mode} mode`, async () => {
    const [alias] = await manifestAliases({
      command: "serve",
      mode,
      isPreview: false,
    });
    assert.equal(alias.find.test("../generated/mdbase-app.json"), true);
    assert.equal(alias.find.test("../generated/other.json"), false);
    assert.equal(
      alias.replacement,
      resolve(
        import.meta.dirname,
        "../src/generated/mdbase-app.development.json",
      ),
    );
  });
}

test("isolates the explicit direct browser build from managed inputs", async () => {
  const config = await viteConfiguration({
    command: "build",
    mode: "self-hosted",
  });
  assert.deepEqual(config.resolve.alias, [
    { find: "@mdbase-dev/sdk", replacement: "@tasknotes/direct-sdk" },
  ]);
  assert.equal(
    config.build.outDir,
    resolve(import.meta.dirname, "../out/self-hosted"),
  );
  assert.equal(
    config.build.rollupOptions.input.app,
    resolve(import.meta.dirname, "../self-hosted/index.html"),
  );
  assert.equal(config.build.copyPublicDir, false);
  assert.equal(config.envDir, false);
  assert.deepEqual(config.envPrefix, []);
  assert.deepEqual(Object.keys(config.build.rollupOptions.input), ["app"]);
  assert.equal(config.server.proxy, undefined);
});

test("cannot opt into the direct entry through the Vite dev server", async () => {
  await assert.rejects(
    viteConfiguration({
      command: "serve",
      mode: "self-hosted",
      isPreview: false,
    }),
    /Use pnpm build:self-hosted/,
  );
});

test("only the managed build accepts a configured HTTPS chooser destination", async (t) => {
  const config = (mode) => viteConfiguration({ command: "build", mode });
  const previous = process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN;
  t.after(() => {
    if (previous === undefined)
      delete process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN;
    else process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN = previous;
  });
  process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN = "https://ui.example/";
  assert.equal(
    (await config("production")).define.__SELF_HOSTED_UI_ORIGIN__,
    JSON.stringify("https://ui.example"),
  );
  assert.equal(
    (await config("self-hosted")).define.__SELF_HOSTED_UI_ORIGIN__,
    "null",
  );
  for (const value of [
    "http://ui.example",
    "https://user@ui.example",
    "https://ui.example/?token=private",
  ]) {
    process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN = value;
    await assert.rejects(config("production"), /canonical HTTPS origin/);
  }
});

for (const environment of [
  { command: "serve", mode: "test", isPreview: false },
  { command: "serve", mode: "production", isPreview: true },
  { command: "build", mode: "production", isPreview: false },
  { command: "build", mode: "e2e", isPreview: false },
]) {
  test(`keeps the production import for ${environment.command}/${environment.mode} (preview=${environment.isPreview})`, async () => {
    assert.deepEqual(await manifestAliases(environment), []);
  });
}

test("direct HTML allows HTTPS and WSS connections and keeps its exfiltration restrictions", async () => {
  const html = await readFile(
    new URL("../self-hosted/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /name="referrer" content="no-referrer"/);
  const policy = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )[1];
  assert.deepEqual(policy.split("; "), [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self' wss: https:",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ]);
  // A meta policy cannot deny framing, and a host may serve other documents.
  const headers = await readFile(
    new URL("../self-hosted/_headers", import.meta.url),
    "utf8",
  );
  assert(
    headers.includes(
      `\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n`,
    ),
  );
  assert(headers.includes("\n  Cross-Origin-Opener-Policy: same-origin\n"));
});
