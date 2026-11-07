import assert from "node:assert/strict";
import { it } from "node:test";
import { indexAssets } from "./rollback.mjs";
it("captures only Pages assets, not source-owned external font services or injected Insights", () => {
  const html =
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Newsreader&display=swap" rel="stylesheet"><link rel="stylesheet" href="/tasknotes.css"><script type="module" src="/assets/index-tasknotes-abcdef123456.js"></script><script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v1"></script>';
  assert.deepEqual(indexAssets(html), [
    "/assets/index-tasknotes-abcdef123456.js",
    "/tasknotes.css",
  ]);
  assert.throws(
    () =>
      indexAssets(
        html + '<script src="https://untrusted.example/code.js"></script>',
      ),
    /same-origin/,
  );
  assert.throws(
    () =>
      indexAssets(
        html + '<script src="https://fonts.googleapis.com/css2"></script>',
      ),
    /same-origin/,
  );
});
