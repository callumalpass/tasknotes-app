import { describe, expect, it, vi } from "vitest";

import {
  candidateBDevelopmentDeployment,
  deployDevelopmentTaskNotes,
  developmentDeployment,
  developmentDeploymentFor,
  developmentDeploymentEnvironment,
} from "./deploy-pages-dev.mjs";

describe("TaskNotes development deployment", () => {
  it("builds the staging Pages origin against staging Connect and its daemon", () => {
    const environment = developmentDeploymentEnvironment({ EXISTING: "kept" });

    expect(environment).toMatchObject({
      EXISTING: "kept",
      VITE_BASE_PATH: "/",
      TASKNOTES_APP_URL: "https://staging.tasknotes-app.pages.dev",
      TASKNOTES_WEB_ONLY: "1",
      TASKNOTES_FIREBASE_PROJECT_ID: "",
      VITE_MDBASE_CONNECT_URL: "https://connect-staging.mdbase.dev",
      VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28486",
    });
  });

  it("deploys Candidate B only to its isolated branch and authority", async () => {
    const environment = {
      MDBASE_CANDIDATE_B_CONNECT_URL:
        "https://mdbase-connect-candidate-b.onrender.com",
    };
    expect(developmentDeploymentFor(environment)).toBe(
      candidateBDevelopmentDeployment,
    );
    expect(developmentDeploymentEnvironment(environment)).toMatchObject({
      TASKNOTES_APP_URL: "https://candidate-b.tasknotes-app.pages.dev",
      VITE_MDBASE_CONNECT_URL:
        "https://mdbase-connect-candidate-b.onrender.com",
    });

    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);
    await deployDevelopmentTaskNotes(environment, { run, verifyBuild });
    expect(run.mock.calls[1][1]).toEqual(
      expect.arrayContaining(["--branch=candidate-b"]),
    );
    expect(run.mock.calls[2][2]).toMatchObject({
      TASKNOTES_PRODUCTION_URL: "https://candidate-b.tasknotes-app.pages.dev",
      MDBASE_CONNECT_ORIGIN: "https://mdbase-connect-candidate-b.onrender.com",
    });
  });

  it("rejects an arbitrary Candidate B authority override", () => {
    expect(() =>
      developmentDeploymentFor({
        MDBASE_CANDIDATE_B_CONNECT_URL: "https://connect.mdbase.dev",
      }),
    ).toThrow("Candidate B TaskNotes requires");
  });

  it("deploys only the staging branch and smokes the same origins", async () => {
    const run = vi.fn(async () => undefined);
    const verifyBuild = vi.fn(async () => undefined);

    await deployDevelopmentTaskNotes({}, { run, verifyBuild });

    expect(verifyBuild).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0][1]).toEqual(["build"]);
    expect(run.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        `wrangler@${developmentDeployment.wranglerVersion}`,
        "pages",
        "deploy",
        "dist",
        "--project-name=tasknotes-app",
        "--branch=staging",
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
