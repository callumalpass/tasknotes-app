import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const scratchRoots = [];

afterEach(async () => {
  await Promise.all(
    scratchRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function scratchCheckout() {
  const scratchParent = resolve(projectRoot, "test-results");
  await mkdir(scratchParent, { recursive: true });
  const root = await mkdtemp(resolve(scratchParent, "manifest-"));
  scratchRoots.push(root);
  await cp(resolve(projectRoot, "scripts"), resolve(root, "scripts"), {
    recursive: true,
  });
  await cp(
    resolve(projectRoot, "vendor/mdbase-contracts"),
    resolve(root, "vendor/mdbase-contracts"),
    {
      recursive: true,
    },
  );
  await symlink(
    resolve(projectRoot, "node_modules"),
    resolve(root, "node_modules"),
    "dir",
  );
  await mkdir(resolve(root, "src/generated"), { recursive: true });
  return root;
}

function generate(root, development) {
  execFileSync(
    process.execPath,
    [
      resolve(root, "scripts/write-manifest.mjs"),
      ...(development ? ["--development"] : []),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        TASKNOTES_APP_URL: development
          ? "http://127.0.0.1:4198"
          : "https://app.tasknotes.dev",
        TASKNOTES_WEB_ONLY: "",
        TASKNOTES_FIREBASE_PROJECT_ID: "",
      },
    },
  );
}

describe("manifest output isolation", () => {
  it("leaves the committed production manifest untouched during development", async () => {
    const root = await scratchCheckout();
    const productionPath = resolve(root, "src/generated/mdbase-app.json");
    const production = await readFile(
      resolve(projectRoot, "src/generated/mdbase-app.json"),
      "utf8",
    );
    await writeFile(productionPath, production);
    generate(root, true);
    expect(await readFile(productionPath, "utf8")).toBe(production);
    const development = await readFile(
      resolve(root, "src/generated/mdbase-app.development.json"),
      "utf8",
    );
    expect(JSON.parse(development).homepage).toBe("http://127.0.0.1:4198/");
    expect(
      await readFile(
        resolve(root, "public/.well-known/mdbase-app.json"),
        "utf8",
      ),
    ).toBe(development);
  });

  it("regenerates the committed production manifest after development", async () => {
    const root = await scratchCheckout();
    generate(root, true);
    const developmentPath = resolve(
      root,
      "src/generated/mdbase-app.development.json",
    );
    const development = await readFile(developmentPath, "utf8");
    generate(root, false);
    const production = await readFile(
      resolve(root, "src/generated/mdbase-app.json"),
      "utf8",
    );
    expect(production).toBe(
      await readFile(
        resolve(projectRoot, "src/generated/mdbase-app.json"),
        "utf8",
      ),
    );
    expect(
      await readFile(
        resolve(root, "public/.well-known/mdbase-app.json"),
        "utf8",
      ),
    ).toBe(production);
    expect(await readFile(developmentPath, "utf8")).toBe(development);
  });
});
