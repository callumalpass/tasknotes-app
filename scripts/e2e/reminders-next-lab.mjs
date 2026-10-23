#!/usr/bin/env node
/** Read-only public LAB preflight. Does not operate browsers or daemons. */
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const LAB = "https://connect-lab.mdbase.dev";

export function assessPreflight(registry, metadata, health) {
  const identity =
    health?.environment === "lab" &&
    health.public_origin === LAB &&
    registry?.connect_origin === LAB &&
    metadata?.environment === "lab";
  const blockers = [];
  if (!identity) blockers.push("lab-identity-mismatch");
  if (registry?.loopback_port === 28487)
    blockers.push("doctor-status-select-forbidden-legacy-daemon");
  blockers.push(
    "public-metadata-does-not-establish-current-next-browser-build-or-remote-push-readiness",
  );
  return {
    environment: "lab",
    identity: identity ? "verified" : "mismatch",
    connectOrigin: LAB,
    result: "blocked",
    blockers,
    daemonInvoked: false,
    browserUsed: false,
  };
}

export async function inspectPreflight(opsRoot, appRoot, fetcher = fetch) {
  if (
    ![opsRoot, appRoot].every((p) =>
      resolve(p).startsWith("/home/calluma/worktrees/"),
    )
  ) {
    throw Error("worktree-source-required");
  }
  // Read only the LAB registry member and existing public application metadata.
  // Do not execute mdbase-env doctor/status: BOTH probe the legacy daemon.
  const registry = JSON.parse(
    await readFile(join(opsRoot, "environments/connect-client.json"), "utf8"),
  ).environments?.lab;
  const metadata = JSON.parse(
    await readFile(join(appRoot, "vendor/native-app-lab.json"), "utf8"),
  );
  const response = await fetcher(`${LAB}/health`, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error("public-health-unavailable");
  return assessPreflight(registry, metadata, await response.json());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const operation =
    args.length === 2 ? inspectPreflight(...args) : Promise.reject();
  operation
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exitCode = 2; // Public metadata never establishes live E2E readiness.
    })
    .catch(() => {
      // Do not echo input or exception text, which may contain private information.
      console.log(
        JSON.stringify({
          environment: "lab",
          result: "blocked",
          blockers: ["preflight-input-or-public-health-unavailable"],
        }),
      );
      process.exitCode = 2;
    });
}
