import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assertDrill,
  assertLiveDrill,
  confirmDrillUpload,
  drillFailure,
} from "./drill.mjs";
const source = "a".repeat(40),
  previousId = "12345678-1234-4234-8234-123456789abc",
  deploymentId = "22345678-1234-4234-8234-123456789abc";
const env = {
  DRILL: "true",
  TARGET: "production",
  SOURCE_SHA: source,
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "123",
  GITHUB_REPOSITORY: "callumalpass/tasknotes-app",
  GITHUB_ACTOR: "operator",
};
it("defaults off and admits only a first-attempt direct human production dispatch", () => {
  for (const DRILL of [undefined, "", "false"])
    assert.equal(assertDrill({ ...env, DRILL }), false);
  assert.equal(assertDrill(env), true);
  for (const patch of [
    { DRILL: "yes" },
    { TARGET: "staging" },
    { GITHUB_EVENT_NAME: "workflow_call" },
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { SOURCE_SHA: "abcd" },
    { GITHUB_ACTOR: "release-automation[bot]" },
    { GITHUB_ACTOR: "" },
  ])
    assert.throws(() => assertDrill({ ...env, ...patch }));
});
it("requires both full canonical Pages source and unambiguous served entry before upload", async () => {
  const active = {
    id: previousId,
    environment: "production",
    deployment_trigger: { metadata: { commit_hash: source } },
  };
  const project = {
    name: "tasknotes-app",
    production_branch: "main",
    canonical_deployment: active,
  };
  const html = `<script type="module" src="/assets/index-abc-${source.slice(0, 12)}.js"></script>`;
  const check = (body = project, entry = html) =>
    assertLiveDrill(
      { id: previousId },
      {
        env,
        accountId: "b".repeat(32),
        apiToken: "test-only",
        fetchImpl: async (url) =>
          url.startsWith("https://api.cloudflare.com/")
            ? Response.json({ success: true, result: body })
            : new Response(entry),
      },
    );
  await check();
  for (const patch of [
    { id: deploymentId },
    { environment: "preview" },
    { deployment_trigger: { metadata: { commit_hash: "c".repeat(40) } } },
    { deployment_trigger: { metadata: { commit_hash: source.slice(0, 12) } } },
  ])
    await assert.rejects(
      check({ ...project, canonical_deployment: { ...active, ...patch } }),
    );
  for (const entry of [
    "",
    html + html,
    html.replace(source.slice(0, 12), "c".repeat(12)),
    html.replace("/assets/", "https://other.invalid/assets/"),
  ])
    await assert.rejects(check(project, entry));
  await assert.rejects(check({ ...project, production_branch: "other" }));
});
it("confirms that a distinct uploaded deployment really became canonical before the fault", async () => {
  const previous = { id: previousId },
    deployment = { id: deploymentId, sourceSha: source, pagesBranch: "main" };
  const active = {
    id: deploymentId,
    environment: "production",
    deployment_trigger: { metadata: { commit_hash: source } },
  };
  const check = (canonical) =>
    confirmDrillUpload(previous, deployment, {
      env,
      accountId: "b".repeat(32),
      apiToken: "test-only",
      fetchImpl: async () =>
        Response.json({
          success: true,
          result: { canonical_deployment: canonical },
        }),
    });
  assert.deepEqual(await check(active), {
    source,
    run: "123",
    attempt: "1",
    previousId,
    deploymentId,
  });
  for (const patch of [
    { id: previousId },
    { environment: "preview" },
    { deployment_trigger: { metadata: { commit_hash: "b".repeat(40) } } },
  ])
    await assert.rejects(check({ ...active, ...patch }));
});
it("fault receipt requires a verified new deployment from this exact run and source", () => {
  const receipt = {
    status: "verified",
    source: { sha: source, target: "production" },
    run: {
      id: "123",
      attempt: "1",
      repository: env.GITHUB_REPOSITORY,
      event: "workflow_dispatch",
      ref: "refs/heads/main",
    },
    previous: { id: previousId },
    deployment: { id: deploymentId, sourceSha: source, pagesBranch: "main" },
  };
  const uploaded = {
    source,
    run: "123",
    attempt: "1",
    previousId,
    deploymentId,
  };
  assert.deepEqual(drillFailure(receipt, uploaded, env), {
    ok: false,
    reason: "production-rollback-drill",
    ...uploaded,
  });
  for (const patch of [
    null,
    {},
    { ...uploaded, deploymentId: previousId },
    { ...uploaded, run: "124" },
  ])
    assert.throws(() => drillFailure(receipt, patch, env));
  for (const patch of [
    { status: "failed-or-incomplete" },
    { source: { sha: "b".repeat(40), target: "production" } },
    { source: { sha: source, target: "staging" } },
    { run: { ...receipt.run, id: "124" } },
    { run: { ...receipt.run, attempt: "2" } },
    { run: { ...receipt.run, repository: "other/repo" } },
    { previous: null },
    { deployment: null },
    { deployment: { ...receipt.deployment, id: previousId } },
    { deployment: { ...receipt.deployment, sourceSha: "b".repeat(40) } },
  ])
    assert.throws(() => drillFailure({ ...receipt, ...patch }, uploaded, env));
});
