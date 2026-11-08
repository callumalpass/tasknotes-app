import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { it } from "node:test";
import { publicBytes } from "./authentication.mjs";
const { parse } = createRequire(
  new URL("../../node_modules/@mdbase-dev/sdk/package.json", import.meta.url),
)("yaml");
it("generic public reads never inherit the ambient job token, including GitHub and lookalike hosts", async () => {
  const before = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "unit-read-token";
  try {
    for (const url of [
      "https://api.github.com/repos/o/r/releases",
      "https://registry.npmjs.org/a",
      "https://github.com/o/r/releases/download/a",
      "https://api.github.com.example/",
    ])
      await publicBytes(
        url,
        async (u, options) => {
          assert.equal(options.headers?.Authorization, undefined);
          assert.equal(options.headers?.authorization, undefined);
          assert.equal(options.redirect, "follow");
          return new Response("bytes");
        },
        [],
      );
  } finally {
    if (before === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = before;
  }
});
it("scopes build authentication to workflow-owned intake and comparison wrappers, not candidate installation or hooks", async () => {
  const w = parse(
    await readFile(
      new URL("../../.github/workflows/deploy-tasknotes.yml", import.meta.url),
      "utf8",
    ),
  );
  const guard = w.jobs.build.steps.find(
    (s) => s.name === "Data-only original intake before dependency execution",
  );
  assert.equal(guard.env.GITHUB_TOKEN, "${{ github.token }}");
  for (const step of w.jobs.build.steps.filter(
    (s) => s !== guard && !s.run?.includes("refs.mjs"),
  )) {
    const intake =
      step.run?.includes("install-inputs.mjs") ||
      step.run?.includes("/publisher/build.mjs");
    assert.equal(
      step.env?.GITHUB_TOKEN,
      intake ? "${{ github.token }}" : undefined,
    );
  }
});
