import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expectedYamlShim,
  assertGeneratedYamlShim,
} from "./lib/native-pnpm-generated.mjs";
const projectRoot = "/repo";
const packageRoot =
  "/repo/node_modules/.pnpm/sdk-entry/node_modules/@mdbase-dev/sdk";
const members = new Map([
  [
    "node_modules/yaml/package.json",
    Buffer.from(
      JSON.stringify({ name: "yaml", version: "2.9.1", bin: "./bin.mjs" }),
    ),
  ],
  [
    "node_modules/yaml/bin.mjs",
    Buffer.from("#!/usr/bin/env node\n// pinned original entry"),
  ],
]);
const externalYamlRoot =
  "/repo/node_modules/.pnpm/yaml@2.9.1/node_modules/yaml";
for (const external of [null, externalYamlRoot])
  test(`pnpm10.7 generated shim byte policy, original-bound target, no shell execution: ${external ? "protocol" : "sdk"}`, () => {
    const bytes = Buffer.from(
      expectedYamlShim(packageRoot, projectRoot, external),
    );
    const input = {
      bytes,
      packageRoot,
      projectRoot,
      members,
      packageManager: "pnpm@10.7.0",
      externalYamlRoot: external,
    };
    assertGeneratedYamlShim(input);
    for (const bad of [
      Buffer.concat([bytes, Buffer.from("touch /tmp/evil\n")]),
      Buffer.from(bytes.toString().replace("exec node", "exec evil")),
      Buffer.from(bytes.toString().replace("bin.mjs", "other.mjs")),
    ])
      assert.throws(
        () => assertGeneratedYamlShim({ ...input, bytes: bad }),
        /byte mismatch/,
      );
    assert.throws(
      () =>
        assertGeneratedYamlShim({ ...input, packageManager: "pnpm@10.20.0" }),
      /qualified/,
    );
    assert.throws(
      () => assertGeneratedYamlShim({ ...input, members: new Map() }),
      /qualified/,
    );
  });
test("generated shim paths cannot inject shell commands or redirect external target", () => {
  for (const root of [
    "/repo;touch-evil",
    "/repo/$evil",
    "/repo/`id`",
    '/repo/"evil',
  ])
    assert.throws(() => expectedYamlShim(root, projectRoot), /path/);
  assert.throws(
    () =>
      assertGeneratedYamlShim({
        bytes: Buffer.from(expectedYamlShim(packageRoot, projectRoot)),
        packageRoot,
        projectRoot,
        members,
        packageManager: "pnpm@10.7.0",
        externalYamlRoot: "/tmp/other",
      }),
    /Unqualified external/,
  );
});
