import { spawn } from "node:child_process";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const developmentDeployments = Object.freeze({
  lab: Object.freeze({
    appOrigin: "https://lab.tasknotes-app.pages.dev",
    connectOrigin: "https://connect-lab.mdbase.dev",
    loopbackOrigin: "http://127.0.0.1:28487",
    project: "tasknotes-app",
    branch: "lab",
    wranglerVersion: "4.114.0",
  }),
  staging: Object.freeze({
    appOrigin: "https://staging.tasknotes-app.pages.dev",
    connectOrigin: "https://connect-staging.mdbase.dev",
    loopbackOrigin: "http://127.0.0.1:28486",
    project: "tasknotes-app",
    branch: "staging",
    wranglerVersion: "4.114.0",
  }),
  "candidate-b": Object.freeze({
    appOrigin: "https://candidate-b.tasknotes-app.pages.dev",
    connectOrigin: "https://mdbase-connect-candidate-b.onrender.com",
    loopbackOrigin: "http://127.0.0.1:28486",
    project: "tasknotes-app",
    branch: "candidate-b",
    wranglerVersion: "4.114.0",
  }),
});

export const developmentDeployment = developmentDeployments.lab;
export const candidateBDevelopmentDeployment =
  developmentDeployments["candidate-b"];

const projectRoot = resolve(import.meta.dirname, "..");
const manifestTargets = [
  resolve(projectRoot, "public", ".well-known", "mdbase-app.json"),
  resolve(projectRoot, "src", "generated", "mdbase-app.json"),
];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await deployDevelopmentTaskNotes(process.env);
}

export function developmentDeploymentFor(environment) {
  const candidateBConnectUrl = environment.MDBASE_CANDIDATE_B_CONNECT_URL;
  const explicitTarget =
    environment.MDBASE_ENV ?? environment.TASKNOTES_DEPLOY_TARGET;
  if (
    candidateBConnectUrl &&
    explicitTarget &&
    explicitTarget !== "candidate-b"
  ) {
    throw new Error(
      "MDBASE_CANDIDATE_B_CONNECT_URL cannot be combined with another TaskNotes deployment target.",
    );
  }

  const target = candidateBConnectUrl
    ? "candidate-b"
    : (explicitTarget ?? "lab");
  const deployment = developmentDeployments[target];
  if (!deployment) {
    throw new Error(
      `Unsupported TaskNotes development deployment target: ${target}.`,
    );
  }
  if (
    candidateBConnectUrl &&
    candidateBConnectUrl !== candidateBDevelopmentDeployment.connectOrigin
  ) {
    throw new Error(
      `Candidate B TaskNotes requires ${candidateBDevelopmentDeployment.connectOrigin}.`,
    );
  }

  requireMatchingOverride(
    environment.MDBASE_CONNECT_URL,
    deployment.connectOrigin,
    target,
    "MDBASE_CONNECT_URL",
  );
  requireMatchingOverride(
    environment.VITE_MDBASE_CONNECT_URL,
    deployment.connectOrigin,
    target,
    "VITE_MDBASE_CONNECT_URL",
  );
  requireMatchingOverride(
    environment.VITE_MDBASE_CONNECT_LOOPBACK_URL,
    deployment.loopbackOrigin,
    target,
    "VITE_MDBASE_CONNECT_LOOPBACK_URL",
  );
  requireMatchingOverride(
    environment.TASKNOTES_APP_URL,
    deployment.appOrigin,
    target,
    "TASKNOTES_APP_URL",
  );
  return deployment;
}

export function developmentDeploymentEnvironment(
  environment,
  deployment = developmentDeploymentFor(environment),
) {
  return {
    ...environment,
    VITE_BASE_PATH: "/",
    TASKNOTES_APP_URL: deployment.appOrigin,
    TASKNOTES_WEB_ONLY: "1",
    TASKNOTES_FIREBASE_PROJECT_ID: "",
    VITE_MDBASE_CONNECT_URL: deployment.connectOrigin,
    VITE_MDBASE_CONNECT_LOOPBACK_URL: deployment.loopbackOrigin,
  };
}

export async function deployDevelopmentTaskNotes(
  environment,
  dependencies = { run: runCommand, verifyBuild: verifyDevelopmentBuild },
) {
  const deployment = developmentDeploymentFor(environment);
  const deploymentEnvironment = developmentDeploymentEnvironment(
    environment,
    deployment,
  );
  const previousManifests = await Promise.all(
    manifestTargets.map(async (target) => {
      try {
        return await readFile(target);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }),
  );

  try {
    await dependencies.run(pnpm, ["build"], deploymentEnvironment);
    await dependencies.verifyBuild(deployment);
  } finally {
    await Promise.all(
      manifestTargets.map((target, index) =>
        previousManifests[index] === null
          ? unlink(target).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            })
          : writeFile(target, previousManifests[index]),
      ),
    );
  }

  await dependencies.run(
    pnpm,
    [
      "dlx",
      `wrangler@${deployment.wranglerVersion}`,
      "pages",
      "deploy",
      "dist",
      `--project-name=${deployment.project}`,
      `--branch=${deployment.branch}`,
      "--commit-dirty=true",
    ],
    deploymentEnvironment,
  );
  await dependencies.run("node", ["scripts/production-smoke.mjs"], {
    ...deploymentEnvironment,
    TASKNOTES_PRODUCTION_URL: deployment.appOrigin,
    MDBASE_CONNECT_ORIGIN: deployment.connectOrigin,
  });

  console.log(`Development TaskNotes deployed: ${deployment.appOrigin}/`);
}

async function verifyDevelopmentBuild(deployment = developmentDeployment) {
  const manifestPath = resolve(
    projectRoot,
    "dist",
    ".well-known",
    "mdbase-app.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const callback = `${deployment.appOrigin}/auth/mdbase/callback`;
  if (
    manifest.homepage !== `${deployment.appOrigin}/` ||
    manifest.icon !== `${deployment.appOrigin}/icon.png` ||
    manifest.redirect_uris?.length !== 1 ||
    manifest.redirect_uris[0] !== callback
  ) {
    throw new Error(
      `TaskNotes deployment manifest does not declare ${deployment.appOrigin}.`,
    );
  }

  const assetsDirectory = resolve(projectRoot, "dist", "assets");
  const scripts = (await readdir(assetsDirectory))
    .filter((file) => file.endsWith(".js"))
    .map((file) => resolve(assetsDirectory, file));
  const sources = await Promise.all(
    scripts.map((script) => readFile(script, "utf8")),
  );
  for (const expected of [
    deployment.connectOrigin,
    deployment.loopbackOrigin,
  ]) {
    if (!sources.some((source) => source.includes(expected))) {
      throw new Error(
        `TaskNotes deployment bundle does not contain ${expected}.`,
      );
    }
  }
}

function requireMatchingOverride(value, expected, target, variable) {
  if (value !== undefined && value !== "" && value !== expected) {
    throw new Error(
      `${target} TaskNotes requires ${variable}=${expected}, received ${value}.`,
    );
  }
}

async function runCommand(command, arguments_, environment) {
  const child = spawn(command, arguments_, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      if (signal) rejectExit(new Error(`${command} was stopped by ${signal}.`));
      else resolveExit(code);
    });
  });
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} exited with code ${exitCode}.`,
    );
  }
}
