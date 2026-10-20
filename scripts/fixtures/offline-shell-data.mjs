// Synthetic UNIT data encoder, never used by publisher/build code.
import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function encodeOfflineShell(
  assets,
  existing = "// unit worker\n",
  base = "/",
) {
  const version = hash(JSON.stringify({ base, assets, existing }));
  return Buffer.from(
    `${existing}\n// mdbase shared offline shell\nimport {installOfflineShell} from "./mdbase-shell-runtime.js";\ninstallOfflineShell(self, ${JSON.stringify({ base, version, assets })});\n`,
  );
}
export function offlineShellFor(files) {
  const assets = Object.entries(files)
    .filter(
      ([p]) =>
        p !== "service-worker.js" &&
        !p.split("/").some((x) => x.startsWith(".") || x.startsWith("_")),
    )
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, bytes]) => ({ path, sha256: hash(bytes) }));
  return encodeOfflineShell(assets);
}
