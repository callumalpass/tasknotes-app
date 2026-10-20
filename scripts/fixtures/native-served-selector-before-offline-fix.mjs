// Frozen OLD selector from 6909753a for real-output RED proof ONLY. Never publication policy.
import { basename } from "node:path";

const controls = new Set([
  "_headers",
  "_redirects",
  "_routes.json",
  ".nojekyll",
]);
const nonservable = (path) =>
  // Wrangler4.114 Pages validate() treats the ROOT .nojekyll as an ordinary
  // static file (not in its IGNORE_LIST). Verify its actual served bytes.
  (controls.has(basename(path)) && path !== ".nojekyll") ||
  path === "_worker.js" ||
  path.startsWith("_worker.js/");

export function selectServedChecks(assets) {
  for (const required of [
    "index.html",
    ".well-known/mdbase-app.json",
    "manifest.webmanifest",
    "service-worker.js",
    "offline-assets.json",
  ]) {
    if (!assets.some((a) => a.path === required))
      throw new Error(`Missing required served asset ${required}.`);
  }
  if (!assets.some((a) => /runtime[^/]*\.wasm$/.test(a.path)))
    throw new Error("Missing native runtime WASM.");
  if (!assets.some((a) => /sqlite[^/]*\.wasm$/.test(a.path)))
    throw new Error("Missing SQLite WASM.");
  return assets
    .filter((a) => !nonservable(a.path))
    .map((asset) => ({
      ...asset,
      urlPath:
        asset.path === "index.html"
          ? "/"
          : asset.path === "404.html"
            ? "/__native_publisher_missing__"
            : "/" +
              (asset.path.endsWith("/index.html")
                ? asset.path.slice(0, -10)
                : asset.path.endsWith(".html")
                  ? asset.path.slice(0, -5)
                  : asset.path),
    }));
}
