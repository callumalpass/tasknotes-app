// Workflow-owned opt-in fault. Never execute candidate code or relax publisher gates.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertDispatch } from "./refs.mjs";
import { pagesApi } from "./rollback.mjs";
const need = (ok, reason) => {
  if (!ok) throw Error(reason);
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function assertDrill(env = process.env) {
  if (env.DRILL === undefined || env.DRILL === "" || env.DRILL === "false")
    return false;
  need(env.DRILL === "true", "invalid-drill-input");
  assertDispatch(env);
  need(
    env.TARGET === "production" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      env.GITHUB_ACTOR &&
      !env.GITHUB_ACTOR.endsWith("[bot]"),
    "manual-production-drill-required",
  );
  return true;
}
export async function assertLiveDrill(
  previous,
  { env = process.env, fetchImpl = fetch, accountId, apiToken } = {},
) {
  need(assertDrill(env), "drill-required");
  const project = await pagesApi("", { accountId, apiToken, fetchImpl }),
    active = project.canonical_deployment;
  need(
    project.name === "tasknotes-app" &&
      project.production_branch === "main" &&
      uuid.test(previous?.id ?? "") &&
      active?.id === previous.id &&
      active.environment === "production" &&
      active.deployment_trigger?.metadata?.commit_hash === env.SOURCE_SHA,
    "drill-source-not-live",
  );
  const response = await fetchImpl("https://app.tasknotes.dev/", {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  need(response.ok, "drill-live-entry-unavailable");
  const html = await response.text();
  need(html.length <= 65536, "drill-live-entry-unavailable");
  const entries = [...html.matchAll(/<script\b[^>]*>/gi)].flatMap(([tag]) => [
    ...tag.matchAll(
      /\ssrc=["']((?:\.\/|\/)?assets\/index-[A-Za-z0-9_-]+-([a-f0-9]{12})\.js)["']/g,
    ),
  ]);
  need(
    entries.length === 1 && entries[0][2] === env.SOURCE_SHA.slice(0, 12),
    "drill-source-not-live",
  );
}
export async function confirmDrillUpload(
  previous,
  deployment,
  { env = process.env, fetchImpl = fetch, accountId, apiToken } = {},
) {
  need(assertDrill(env), "drill-required");
  need(
    uuid.test(previous?.id ?? "") &&
      uuid.test(deployment?.id ?? "") &&
      previous.id !== deployment.id &&
      deployment.sourceSha === env.SOURCE_SHA &&
      deployment.pagesBranch === "main",
    "drill-real-upload-required",
  );
  const active = (await pagesApi("", { accountId, apiToken, fetchImpl }))
    .canonical_deployment;
  need(
    active?.id === deployment.id &&
      active.environment === "production" &&
      active.deployment_trigger?.metadata?.commit_hash === env.SOURCE_SHA,
    "drill-upload-not-active",
  );
  return {
    source: env.SOURCE_SHA,
    run: env.GITHUB_RUN_ID,
    attempt: "1",
    previousId: previous.id,
    deploymentId: deployment.id,
  };
}
export function drillFailure(receipt, uploaded, env = process.env) {
  need(assertDrill(env), "drill-required");
  need(
    receipt?.status === "verified" &&
      receipt.source?.sha === env.SOURCE_SHA &&
      receipt.source?.target === "production" &&
      receipt.run?.id === env.GITHUB_RUN_ID &&
      receipt.run?.attempt === "1" &&
      receipt.run?.repository === env.GITHUB_REPOSITORY &&
      receipt.run?.event === "workflow_dispatch" &&
      receipt.run?.ref === "refs/heads/main" &&
      uuid.test(receipt.previous?.id ?? "") &&
      uuid.test(receipt.deployment?.id ?? "") &&
      receipt.previous.id !== receipt.deployment.id &&
      receipt.deployment.sourceSha === env.SOURCE_SHA &&
      receipt.deployment.pagesBranch === "main",
    "drill-real-upload-required",
  );
  const binding = {
    source: env.SOURCE_SHA,
    run: env.GITHUB_RUN_ID,
    attempt: "1",
    previousId: receipt.previous.id,
    deploymentId: receipt.deployment.id,
  };
  need(
    uploaded &&
      Object.entries(binding).every(([key, value]) => uploaded[key] === value),
    "drill-active-upload-evidence-required",
  );
  return { ok: false, reason: "production-rollback-drill", ...binding };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, directory, output] = process.argv.slice(2),
    json = async (name) =>
      JSON.parse(await readFile(`${directory}/${name}.json`, "utf8"));
  try {
    if (command === "admit") assertDrill();
    else if (command === "before-upload")
      await assertLiveDrill(await json("previous"), {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
      });
    else if (command === "uploaded")
      await writeFile(
        `${directory}/drill-upload.json`,
        JSON.stringify(
          await confirmDrillUpload(
            await json("previous"),
            await json("deployment"),
            {
              accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
              apiToken: process.env.CLOUDFLARE_API_TOKEN,
            },
          ),
          null,
          2,
        ),
      );
    else if (command === "fail") {
      await writeFile(
        output,
        JSON.stringify(
          drillFailure(await json("receipt"), await json("drill-upload")),
          null,
          2,
        ),
      );
      console.error(
        "Deliberate production smoke failure after verified same-source upload",
      );
      process.exitCode = 1;
    } else throw Error("unknown-drill-command");
  } catch {
    console.error("TaskNotes drill refused");
    process.exitCode = 1;
  }
}
