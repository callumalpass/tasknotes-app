import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { upload } from "./native-publisher-upload.mjs";
import { verifyTargetIntake } from "./lib/native-publish-intake.mjs";
import { NATIVE_PUBLISH_TARGETS } from "./native-publisher.mjs";
test("Co064253: actual historical UI labels do not veto STAGING protected-hash + approved-lock intake", async () => {
  const result = await verifyTargetIntake({
    root: new URL("../", import.meta.url).pathname,
    target: NATIVE_PUBLISH_TARGETS.staging,
    approvedHashes: {
      sdk: "15eb64b50fc7c2809ff3dba9cce5104fe48d8592208b3af8acb529862a1af18c",
      ui: "e3da3c19b49ee90d3d19df2ea4a1a387b158decfccc8000371f93170eb30b723",
      protocol:
        "cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138",
      asset: "67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7",
    },
  });
  assert.deepEqual(result.publicationConstraints, []);
  assert.deepEqual(result.historicalUiQualification, {
    noPublication: true,
    pairedSdkSource: "cc492f3f3832c4939eff7fe39b0fabf5ad234b24",
  });
});
const sha = "a".repeat(40);
for (const label of ["before", "run", "after", "runAfter"])
  for (const status of [403, 404, 429])
    test(`observed HTTP ${status} ${label} body/status survive before refusal, no NEXT request`, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "tn-http-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const evidence = join(directory, "evidence");
      const bytes = Buffer.from(
        "not a zip; HTTP refusal must precede extraction",
      );
      const digest = createHash("sha256").update(bytes).digest("hex");
      const metadata = {
        id: 42,
        digest: `sha256:${digest}`,
        expired: false,
        name: `tasknotes-native-build-staging-${sha}-11-2`,
        workflow_run: {
          id: 11,
          head_sha: sha,
          repository_id: 7,
          head_repository_id: 7,
          head_branch: "release/native-staging",
        },
      };
      const run = {
        id: 11,
        run_attempt: 2,
        head_sha: sha,
        event: "workflow_dispatch",
        head_branch: "release/native-staging",
        repository: { id: 7, full_name: "unit-test/tasknotes" },
      };
      const labels = ["before", "run", "zip", "blob", "after", "runAfter"];
      let count = 0;
      const body = JSON.stringify({
        message: `public HTTP ${status}`,
        status: String(status),
      });
      t.mock.method(globalThis, "fetch", async () => {
        const current = labels[count++];
        assert.ok(
          count <= labels.indexOf(label) + 1,
          "no next lookup/ZIP/CF after refusal",
        );
        if (current === label)
          return new Response(body, {
            status,
            headers: { "x-private-canary": "NEVER-RETAIN-HEADER" },
          });
        if (current === "zip")
          return new Response(null, {
            status: 302,
            headers: {
              location:
                "https://example.blob.core.windows.net/unit?signed=NEVER-RETAIN-SAS",
            },
          });
        if (current === "blob") return new Response(bytes);
        return Response.json(
          current === "before" || current === "after" ? metadata : run,
        );
      });
      await assert.rejects(
        upload(
          {
            RUNNER_TEMP: directory,
            NATIVE_EVIDENCE_PATH: evidence,
            GITHUB_EVENT_NAME: "workflow_dispatch",
            NATIVE_TARGET: "staging",
            NATIVE_SOURCE_SHA: sha,
            GITHUB_SHA: sha,
            GITHUB_REF: "refs/heads/release/native-staging",
            GITHUB_REPOSITORY: "unit-test/tasknotes",
            GITHUB_RUN_ID: "11",
            GITHUB_RUN_ATTEMPT: "2",
            NATIVE_ARTIFACT_ID: "42",
            NATIVE_ARTIFACT_DIGEST: digest,
            GITHUB_TOKEN: "NEVER-RETAIN-TOKEN",
          },
          { checkout: async () => {}, intake: async () => ({}) },
        ),
      );
      assert.equal(count, labels.indexOf(label) + 1);
      assert.equal(
        await readFile(join(evidence, `${label}.json`), "utf8"),
        body,
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(join(evidence, `${label}.http.json`), "utf8"),
        ),
        { status },
      );
      const receipt = await readFile(join(evidence, "receipt.json"), "utf8");
      assert.doesNotMatch(receipt, /NEVER-RETAIN/);
      const trace = await readFile(
        join(evidence, "artifact-fetch-evidence.json"),
        "utf8",
      );
      assert.equal(JSON.parse(trace).failureStage, `http-${label}`);
      assert.doesNotMatch(trace, /NEVER-RETAIN/);
    });

for (const scenario of ["malformed-200", "oversized-403", "transport"])
  test(`HTTP evidence bounds/parse/transport semantics: ${scenario}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "tn-http-bound-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const evidence = join(directory, "evidence");
    let calls = 0;
    const body =
      scenario === "oversized-403"
        ? "x".repeat(2 * 1024 * 1024 + 1)
        : "{public malformed JSON";
    t.mock.method(globalThis, "fetch", async () => {
      assert.equal(++calls, 1);
      if (scenario === "transport") throw new Error("OPAQUE-PRIVATE");
      return new Response(body, {
        status: scenario === "oversized-403" ? 403 : 200,
      });
    });
    await assert.rejects(
      upload(
        {
          RUNNER_TEMP: directory,
          NATIVE_EVIDENCE_PATH: evidence,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          NATIVE_TARGET: "staging",
          NATIVE_SOURCE_SHA: sha,
          GITHUB_SHA: sha,
          GITHUB_REF: "refs/heads/release/native-staging",
          GITHUB_REPOSITORY: "unit-test/tasknotes",
          GITHUB_RUN_ID: "11",
          GITHUB_RUN_ATTEMPT: "2",
          NATIVE_ARTIFACT_ID: "42",
          NATIVE_ARTIFACT_DIGEST: "b".repeat(64),
        },
        { checkout: async () => {}, intake: async () => ({}) },
      ),
    );
    if (scenario === "transport") {
      await assert.rejects(readFile(join(evidence, "before.json")), /ENOENT/);
      await assert.rejects(
        readFile(join(evidence, "before.http.json")),
        /ENOENT/,
      );
    } else {
      assert.equal(
        await readFile(join(evidence, "before.json"), "utf8"),
        body.slice(0, 2 * 1024 * 1024),
      );
      assert.equal(
        JSON.parse(await readFile(join(evidence, "before.http.json"), "utf8"))
          .status,
        scenario === "oversized-403" ? 403 : 200,
      );
    }
    assert.equal(calls, 1);
    assert.doesNotMatch(
      await readFile(join(evidence, "receipt.json"), "utf8"),
      /OPAQUE-PRIVATE/,
    );
    if (scenario === "malformed-200")
      assert.equal(
        JSON.parse(
          await readFile(join(evidence, "artifact-fetch-evidence.json")),
        ).failureStage,
        "parse-before",
      );
  });
