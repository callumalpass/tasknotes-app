import { describe, expect, it, vi } from "vitest";

import {
  deployDevelopmentTaskNotes,
  developmentDeployment,
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
      VITE_MDBASE_CONNECT_URL: "https://mdbase-connect-staging.onrender.com",
      VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28486",
    });
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
