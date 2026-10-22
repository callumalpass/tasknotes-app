import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError } from "@mdbase-dev/sdk";

for (const code of [
  "declared_setup_unsupported",
  "resource_setup_unsupported",
  "type_packs_unsupported",
]) {
  test(`${code} offers a computer update instead of generic support guidance`, () => {
    const description = describeError({ kind: "blocked", problem: { code } });
    assert.equal(description.key, "update_required");
    assert.equal(description.action, "update_app");
    assert.equal(description.actionLabel, "Update mdbase");
    assert.match(description.message, /mdbase on this computer/);
    assert.equal(description.updateUrl, "https://mdbase.dev/downloads/");
    assert.doesNotMatch(
      description.message,
      /unexpected problem|contact support/,
    );
  });
}
