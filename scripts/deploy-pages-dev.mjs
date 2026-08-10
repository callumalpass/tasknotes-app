import { spawn } from "node:child_process";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const developmentDeployment = Object.freeze({
  appOrigin: "https://staging.tasknotes-app.pages.dev",
  connectOrigin: "https://connect-staging.mdbase.dev",
  loopbackOrigin: "http://127.0.0.1:28486",
  project: "tasknotes-app",
  branch: "staging",
  wranglerVersion: "4.114.0",
});

const projectRoot = resolve(import.meta.dirname, "..");
const manifestTargets = [
  resolve(projectRoot, "public", ".well-known", "mdbase-app.json"),
  resolve(projectRoot, "src", "generated", "mdbase-app.json"),
];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await deployDevelopmentTaskNotes(process.env);
}

export function developmentDeploymentEnvironment(environment) {
  return {
    ...environment,
    VITE_BASE_PATH: "/",
    TASKNOTES_APP_URL: developmentDeployment.appOrigin,
    TASKNOTES_WEB_ONLY: "1",
    TASKNOTES_FIREBASE_PROJECT_ID: "",
    VITE_MDBASE_CONNECT_URL: developmentDeployment.connectOrigin,
    VITE_MDBASE_CONNECT_LOOPBACK_URL: developmentDeployment.loopbackOrigin,
  };
}

export async function deployDevelopmentTaskNotes(
  environment,
  dependencies = { run: runCommand, verifyBuild: verifyDevelopmentBuild },
) {
  const deploymentEnvironment = developmentDeploymentEnvironment(environment);
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
    await dependencies.verifyBuild();
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
      `wrangler@${developmentDeployment.wranglerVersion}`,
      "pages",
      "deploy",
      "dist",
      `--project-name=${developmentDeployment.project}`,
      `--branch=${developmentDeployment.branch}`,
      "--commit-dirty=true",
    ],
    deploymentEnvironment,
  );
  await dependencies.run("node", ["scripts/production-smoke.mjs"], {
    ...deploymentEnvironment,
    TASKNOTES_PRODUCTION_URL: developmentDeployment.appOrigin,
    MDBASE_CONNECT_ORIGIN: developmentDeployment.connectOrigin,
  });

  console.log(
    `Development TaskNotes deployed: ${developmentDeployment.appOrigin}/`,
  );
}

async function verifyDevelopmentBuild() {
  const manifestPath = resolve(
    projectRoot,
    "dist",
    ".well-known",
    "mdbase-app.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const callback = `${developmentDeployment.appOrigin}/auth/mdbase/callback`;
  if (
    manifest.homepage !== `${developmentDeployment.appOrigin}/` ||
    manifest.icon !== `${developmentDeployment.appOrigin}/icon.png` ||
    manifest.redirect_uris?.length !== 1 ||
    manifest.redirect_uris[0] !== callback
  ) {
    throw new Error(
      `TaskNotes deployment manifest does not declare ${developmentDeployment.appOrigin}.`,
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
    developmentDeployment.connectOrigin,
    developmentDeployment.loopbackOrigin,
  ]) {
    if (!sources.some((source) => source.includes(expected))) {
      throw new Error(
        `TaskNotes deployment bundle does not contain ${expected}.`,
      );
    }
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
