import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  candidateBDevelopmentDeployment,
  deployDevelopmentTaskNotes,
  developmentDeployment,
  developmentDeploymentFor,
  developmentDeployments,
  developmentDeploymentEnvironment,
  requireBundledTrust,
  restoreFile,
} from "./deploy-pages-dev.mjs";

const repositoryPackage = join(import.meta.dirname, "..", "package.json");
const scratchRoots = [];

/** A disposable checkout holding the files a LAB deployment swaps and restores. */
async function scratchCheckout() {
  const root = await mkdtemp(join(tmpdir(), "tasknotes-deploy-dev-"));
  scratchRoots.push(root);
  await mkdir(join(root, "public", ".well-known"), { recursive: true });
  await mkdir(join(root, "src", "generated"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"scratch"}\n');
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(join(root, "public", ".well-known", "mdbase-app.json"), "{}");
  await writeFile(join(root, "src", "generated", "mdbase-app.json"), "{}");
  return root;
}

afterEach(async () => {
  await Promise.all(
    scratchRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("TaskNotes development deployment", () => {
  it("defaults to the isolated LAB application and Connect authority", () => {
    expect(developmentDeploymentFor({})).toBe(developmentDeployments.lab);

    const environment = developmentDeploymentEnvironment({ EXISTING: "kept" });

    expect(environment).toMatchObject({
      EXISTING: "kept",
      VITE_BASE_PATH: "/",
      TASKNOTES_APP_URL: "https://lab.tasknotes-app.pages.dev",
      TASKNOTES_WEB_ONLY: "1",
      TASKNOTES_FIREBASE_PROJECT_ID: "",
      VITE_MDBASE_CONNECT_URL: "https://connect-lab.mdbase.dev",
      VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487",
      VITE_TASKNOTES_ENVIRONMENT: "lab",
      VITE_TASKNOTES_LAB_ORIGIN: "https://lab.tasknotes-app.pages.dev",
      VITE_TASKNOTES_EDITOR_ORIGIN: "https://lab.mdbase-editor-lab.pages.dev",
    });
  });

  it("refuses a mismatched LAB app origin and a missing Editor origin", () => {
    expect(() =>
      developmentDeploymentFor({
        VITE_TASKNOTES_LAB_ORIGIN: "https://staging.tasknotes.dev",
      }),
    ).toThrow(/VITE_TASKNOTES_LAB_ORIGIN/);
    // Candidate B has no documented Editor origin, so it stays explicit.
    expect(() =>
      developmentDeploymentEnvironment({
        MDBASE_CANDIDATE_B_CONNECT_URL:
          "https://mdbase-connect-candidate-b.onrender.com",
      }),
    ).toThrow(/VITE_TASKNOTES_EDITOR_ORIGIN is required/);
  });

  it("refuses staging and production: only shared App CD may publish those targets", () => {
    for (const MDBASE_ENV of ["staging", "production"]) {
      expect(() => developmentDeploymentFor({ MDBASE_ENV })).toThrow(
        "Unsupported TaskNotes development deployment target",
      );
      expect(() => developmentDeploymentEnvironment({ MDBASE_ENV })).toThrow(
        "Unsupported TaskNotes development deployment target",
      );
    }
  });

  it("selects Candidate B only with its isolated authority", () => {
    const environment = {
      MDBASE_CANDIDATE_B_CONNECT_URL:
        "https://mdbase-connect-candidate-b.onrender.com",
      VITE_TASKNOTES_EDITOR_ORIGIN: "https://candidate-b.example.test",
    };
    expect(developmentDeploymentFor(environment)).toBe(
      candidateBDevelopmentDeployment,
    );
    expect(developmentDeploymentEnvironment(environment)).toMatchObject({
      TASKNOTES_APP_URL: "https://candidate-b.tasknotes-app.pages.dev",
      VITE_MDBASE_CONNECT_URL:
        "https://mdbase-connect-candidate-b.onrender.com",
      // Candidate B is a LAB-environment build against its own Connect.
      VITE_TASKNOTES_ENVIRONMENT: "lab",
      VITE_TASKNOTES_LAB_ORIGIN: "https://candidate-b.tasknotes-app.pages.dev",
    });
  });

  it("rejects unknown targets and cross-environment URL overrides", () => {
    expect(() =>
      developmentDeploymentFor({ MDBASE_ENV: "production" }),
    ).toThrow(
      "Unsupported TaskNotes development deployment target: production",
    );
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "lab",
        MDBASE_CONNECT_URL: "https://connect.mdbase.dev",
      }),
    ).toThrow("lab TaskNotes requires MDBASE_CONNECT_URL");
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "lab",
        TASKNOTES_APP_URL: "https://staging.tasknotes.dev",
      }),
    ).toThrow("lab TaskNotes requires TASKNOTES_APP_URL");
  });

  it("rejects an arbitrary Candidate B authority override", () => {
    expect(() =>
      developmentDeploymentFor({
        MDBASE_CANDIDATE_B_CONNECT_URL: "https://connect.mdbase.dev",
      }),
    ).toThrow("Candidate B TaskNotes requires");
  });

  it("cannot upload staging through the retired native development route", async () => {
    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);
    await expect(
      deployDevelopmentTaskNotes(
        { MDBASE_ENV: "staging" },
        { run, verifyBuild },
      ),
    ).rejects.toThrow("Unsupported TaskNotes development deployment target");
    expect(run).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
  });

  it("deploys only the LAB branch and smokes the same origins by default", async () => {
    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);

    const root = await scratchCheckout();

    await deployDevelopmentTaskNotes({}, { run, verifyBuild, root });

    expect(verifyBuild).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[0][1]).toEqual([
      "add",
      "--ignore-scripts",
      `@mdbase-dev/sdk@file:${developmentDeployment.sdkArtifact}`,
    ]);
    expect(run.mock.calls[1][1]).toEqual(["build:assets"]);
    expect(run.mock.calls[2][1]).toEqual(
      expect.arrayContaining([
        `wrangler@${developmentDeployment.wranglerVersion}`,
        "pages",
        "deploy",
        "dist",
        "--project-name=tasknotes-app",
        "--branch=lab",
      ]),
    );
    expect(run.mock.calls[3]).toEqual([
      "node",
      ["scripts/production-smoke.mjs"],
      expect.objectContaining({
        TASKNOTES_PRODUCTION_URL: developmentDeployment.appOrigin,
        MDBASE_CONNECT_ORIGIN: developmentDeployment.connectOrigin,
      }),
    ]);
  });

  // #412: restoring the real package.json with a truncating write let a
  // concurrent Vitest worker resolve it as an empty file.
  it("restores swapped files in the given root without touching the repository", async () => {
    const before = await stat(repositoryPackage);
    const root = await scratchCheckout();
    const original = await readFile(join(root, "package.json"));
    const run = vi.fn(async (_command, arguments_) => {
      if (arguments_[0] === "add")
        await writeFile(join(root, "package.json"), '{"name":"swapped"}\n');
    });

    await deployDevelopmentTaskNotes(
      {},
      { run, verifyBuild: vi.fn(async () => undefined), root },
    );

    expect(await readFile(join(root, "package.json"))).toEqual(original);
    const after = await stat(repositoryPackage);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it.each(["success", "build", "verification"])(
    "restores both production manifests after %s without changing the dev manifest",
    async (outcome) => {
      const root = await scratchCheckout();
      const targets = [
        "public/.well-known/mdbase-app.json",
        "src/generated/mdbase-app.json",
        "package.json",
        "pnpm-lock.yaml",
      ];
      const originals = await Promise.all(
        targets.map((target) => readFile(join(root, target))),
      );
      const development = join(
        root,
        "src/generated/mdbase-app.development.json",
      );
      await writeFile(development, '{"homepage":"http://127.0.0.1:4173/"}');
      const originalDevelopment = await readFile(development);
      const run = vi.fn(async (_command, arguments_) => {
        if (arguments_[0] !== "build:assets") return;
        await Promise.all(
          targets.map((target) => writeFile(join(root, target), "swapped")),
        );
        if (outcome === "build") throw new Error("build failed");
      });
      const verifyBuild = vi.fn(async () => {
        if (outcome === "verification") throw new Error("verification failed");
      });
      const deployment = deployDevelopmentTaskNotes(
        {},
        { run, verifyBuild, root },
      );
      if (outcome === "success") await deployment;
      else await expect(deployment).rejects.toThrow(`${outcome} failed`);
      expect(
        await Promise.all(
          targets.map((target) => readFile(join(root, target))),
        ),
      ).toEqual(originals);
      expect(await readFile(development)).toEqual(originalDevelopment);
      if (outcome !== "success") {
        expect(
          run.mock.calls.some(([, arguments_]) =>
            arguments_.includes("deploy"),
          ),
        ).toBe(false);
      }
    },
  );

  it("replaces a changed file by rename and leaves an unchanged one alone", async () => {
    const root = await scratchCheckout();
    const target = join(root, "package.json");
    const original = await readFile(target);
    const untouched = await stat(target);

    await restoreFile(target, original);
    const unchanged = await stat(target);
    expect(unchanged.ino).toBe(untouched.ino);
    expect(unchanged.mtimeMs).toBe(untouched.mtimeMs);

    await writeFile(target, '{"name":"swapped"}\n');
    await restoreFile(target, original);
    expect(await readFile(target)).toEqual(original);
    // A new inode means the bytes arrived by rename, not by truncating in place.
    expect((await stat(target)).ino).not.toBe(untouched.ino);
  });

  it("refuses a bundle whose SDK trusts another environment", () => {
    const lab = developmentDeployments.lab;
    const trust = (environment) =>
      `N={schema:\`mdbn-app-trust/release/1\`,environment:\`${environment}\`}`;

    expect(() => requireBundledTrust([trust("lab")], lab)).not.toThrow();
    expect(() => requireBundledTrust([trust("production")], lab)).toThrow(
      "carries SDK trust for production",
    );
    expect(() => requireBundledTrust(["no trust here"], lab)).toThrow(
      "for no environment",
    );
  });
});
