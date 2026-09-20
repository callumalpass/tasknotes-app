import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Opt-in authority integration probe. It uses only its own disposable directory,
// never a daemon, login, production collection, or the user's note folders.
const cli = process.env.MDBASE_TEST_CLI;
test(
  "Rust authority returns body-match evidence without returning body text",
  { skip: !cli },
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "tasknotes-search-projection-test-"),
    );
    try {
      await writeFile(
        join(root, "mdbase.yaml"),
        'spec_version: "0.3.0"\nname: "[test] body search evidence"\n',
      );
      await writeFile(
        join(root, "one.md"),
        '---\ntitle: One\n---\nNeedle αβ and "quoted" content.',
      );
      await writeFile(
        join(root, "two.md"),
        "---\ntitle: Two\n---\nUnrelated content.",
      );
      const request = {
        where:
          'file.body.lower().contains("needle") || file.body.lower().contains("missing")',
        include_body: false,
        projections: {
          tasknotes_body_0: 'file.body.lower().contains("needle")',
          tasknotes_body_1: 'file.body.lower().contains("missing")',
        },
        select: [
          "file.path",
          "projection.tasknotes_body_0",
          "projection.tasknotes_body_1",
        ],
      };
      const outcome = JSON.parse(
        execFileSync(cli, ["query", "-C", root, "--request", "-"], {
          input: JSON.stringify(request),
          encoding: "utf8",
          timeout: 30_000,
        }),
      );
      assert.equal(outcome.valid, true, JSON.stringify(outcome.diagnostics));
      const rows = outcome.result.results;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].path, "one.md");
      assert.equal(rows[0].values.tasknotes_body_0, true);
      assert.equal(rows[0].values.tasknotes_body_1, false);
      assert.equal("body" in rows[0], false);
      assert.equal("body" in rows[0].file, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
