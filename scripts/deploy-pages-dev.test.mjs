import { describe, expect, it, vi } from "vitest";

import {
  candidateBDevelopmentDeployment,
  deployDevelopmentTaskNotes,
  developmentDeployment,
  developmentDeploymentFor,
  developmentDeployments,
  developmentDeploymentEnvironment,
} from "./deploy-pages-dev.mjs";

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
      VITE_TASKNOTES_ENVIRONMENT: "lab",
      VITE_TASKNOTES_LAB_ORIGIN: "https://lab.tasknotes-app.pages.dev",
      VITE_TASKNOTES_EDITOR_ORIGIN: "https://lab.mdbase-editor-lab.pages.dev",
    });
  });

  it("rejects legacy loopback input for NEXT LAB and never injects it", () => {
    expect(developmentDeployments.lab).not.toHaveProperty("loopbackOrigin");
    expect(developmentDeploymentEnvironment({})).not.toHaveProperty(
      "VITE_MDBASE_CONNECT_LOOPBACK_URL",
    );
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "lab",
        VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487",
      }),
    ).toThrow(/VITE_MDBASE_CONNECT_LOOPBACK_URL/);
    expect(
      developmentDeploymentEnvironment(
        { VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487" },
        developmentDeployments.lab,
      ),
    ).not.toHaveProperty("VITE_MDBASE_CONNECT_LOOPBACK_URL");
  });

  it("refuses a mismatched LAB app origin and a missing Editor origin", () => {
    expect(() =>
      developmentDeploymentFor({
        VITE_TASKNOTES_LAB_ORIGIN: "https://staging.tasknotes-app.pages.dev",
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

  it("selects staging only when explicitly requested", () => {
    const environment = { MDBASE_ENV: "staging" };

    expect(developmentDeploymentFor(environment)).toBe(
      developmentDeployments.staging,
    );
    expect(developmentDeploymentEnvironment(environment)).toMatchObject({
      TASKNOTES_APP_URL: "https://staging.tasknotes-app.pages.dev",
      VITE_MDBASE_CONNECT_URL: "https://connect-staging.mdbase.dev",
      VITE_TASKNOTES_ENVIRONMENT: "staging",
      VITE_TASKNOTES_LAB_ORIGIN: "",
      VITE_TASKNOTES_EDITOR_ORIGIN: "https://editor-staging.mdbase.dev",
    });
  });

  it("never includes a Connect loopback URL in native staging targets", () => {
    expect(developmentDeployments.staging).not.toHaveProperty("loopbackOrigin");
    expect(
      developmentDeploymentEnvironment({ MDBASE_ENV: "staging" }),
    ).not.toHaveProperty("VITE_MDBASE_CONNECT_LOOPBACK_URL");
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "staging",
        VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28486",
      }),
    ).toThrow(/VITE_MDBASE_CONNECT_LOOPBACK_URL/);
    // A caller passing an already-selected target cannot leak an inherited
    // loopback setting into the native build environment either.
    expect(
      developmentDeploymentEnvironment(
        { VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487" },
        developmentDeployments.staging,
      ),
    ).not.toHaveProperty("VITE_MDBASE_CONNECT_LOOPBACK_URL");
  });

  it("refuses LAB or cross-environment input on the staging target", () => {
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "staging",
        VITE_TASKNOTES_LAB_ORIGIN: "https://lab.tasknotes-app.pages.dev",
      }),
    ).toThrow(/VITE_TASKNOTES_LAB_ORIGIN/);
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "staging",
        VITE_TASKNOTES_EDITOR_ORIGIN: "https://lab.mdbase-editor-lab.pages.dev",
      }),
    ).toThrow(/VITE_TASKNOTES_EDITOR_ORIGIN/);
    expect(() =>
      developmentDeploymentFor({
        MDBASE_ENV: "staging",
        MDBASE_CONNECT_URL: "https://connect-lab.mdbase.dev",
      }),
    ).toThrow("staging TaskNotes requires MDBASE_CONNECT_URL");
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
      VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28486",
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
        TASKNOTES_APP_URL: "https://staging.tasknotes-app.pages.dev",
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

  it("builds staging assets without the production-only wrapper", async () => {
    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);
    await deployDevelopmentTaskNotes(
      { MDBASE_ENV: "staging" },
      { run, verifyBuild },
    );
    expect(run.mock.calls[0][1]).toEqual([
      "add",
      "--ignore-scripts",
      "@mdbase-dev/sdk@file:vendor/sdk-dev-eaa4e697-staging.tgz",
    ]);
    expect(run.mock.calls[1]).toEqual([
      expect.stringMatching(/^pnpm/),
      ["build:assets"],
      expect.objectContaining({ VITE_TASKNOTES_ENVIRONMENT: "staging" }),
    ]);
    expect(verifyBuild).toHaveBeenCalledWith(developmentDeployments.staging);
    expect(run.mock.calls[2][1]).toContain("--branch=staging");
  });

  it("deploys only the LAB branch and smokes the same origins by default", async () => {
    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);

    await deployDevelopmentTaskNotes({}, { run, verifyBuild });

    expect(verifyBuild).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0][1]).toEqual(["build:assets"]);
    expect(run.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        `wrangler@${developmentDeployment.wranglerVersion}`,
        "pages",
        "deploy",
        "dist",
        "--project-name=tasknotes-app",
        "--branch=lab",
      ]),
    );
    expect(run.mock.calls[2]).toEqual([
      "node",
      ["scripts/production-smoke.mjs"],
      expect.objectContaining({
        TASKNOTES_PRODUCTION_URL: developmentDeployment.appOrigin,
        MDBASE_CONNECT_ORIGIN: developmentDeployment.connectOrigin,
      }),
    ]);
  });
});
