// Node-only test adapter. Never imported by the product or used as native proof.
import { readFileSync } from "node:fs";
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
