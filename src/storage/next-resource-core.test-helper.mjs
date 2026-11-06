// Node-only test inputs. Never imported by the product.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { URL } from "node:url";
import { createHash } from "node:crypto";
export function pinnedCoreBytes() {
  return readFileSync(
    new URL("../../node_modules/mdbase/wasm/mdbase-core.wasm", import.meta.url),
  );
}
export function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}
export function pinnedBasesWitnessBytes() {
  return new Uint8Array(
    gunzipSync(
      readFileSync(
        new URL(
          "../../vendor/runtime-bases-witness-4370800f.wasm.gz",
          import.meta.url,
        ),
      ),
    ),
  );
}
