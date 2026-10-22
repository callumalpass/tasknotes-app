import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatManifestValidationIssues,
  validateAppManifest,
} from "@mdbase-dev/connect-protocol/manifest";

// Same canonical validator the mdbase-connect-dev CLI wraps, but resolved
// from this app's pinned connect-protocol. The CLI's older bundled protocol
// rejects installation_origins, which the pinned protocol (and the SDK/CP
// runtime parser) already accept. TODO: return to the CLI once its bundled
// protocol is repinned alongside the per-environment SDK archives.
export function validateManifestValue(value, { allowLocal = false } = {}) {
  return validateAppManifest(value, { allowLocal });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arguments_ = process.argv.slice(2);
  const allowLocal = arguments_.includes("--allow-local");
  const [source] = arguments_.filter(
    (argument) => argument !== "--allow-local",
  );
  if (!source) {
    console.error(
      "Usage: node scripts/validate-manifest.mjs <file.json> [--allow-local]",
    );
    process.exitCode = 2;
  } else {
    try {
      const value = JSON.parse(await readFile(resolve(source), "utf8"));
      const result = validateManifestValue(value, { allowLocal });
      if (result.valid) {
        console.log(`${source} is valid`);
      } else {
        console.error(formatManifestValidationIssues(result.issues));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
