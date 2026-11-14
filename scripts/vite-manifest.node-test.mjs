import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadConfigFromFile } from "vite";

async function manifestAliases(environment) {
  const { config } = await loadConfigFromFile(
    environment,
    resolve(import.meta.dirname, "../vite.config.ts"),
  );
  return config.resolve.alias;
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
