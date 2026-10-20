import { basename } from "node:path";
import { verifyServedBytes } from "./lib/native-publish-bytes.mjs";
import { assertTrustedHeaders } from "./lib/native-publish-hosting.mjs";

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

/** Source-reviewed mapping only; NEVER consume mappings from the artifact. */
export async function verifyServedAssets({
  origin,
  assets,
  fetchImpl = fetch,
  sleep,
  attempts,
  retryMs,
  timeoutMs,
  maxTimeMs,
}) {
  if (
    ![
      "https://staging.tasknotes-app.pages.dev",
      "https://app.tasknotes.dev",
    ].includes(origin)
  )
    throw new Error(
      "Served verifier requires the real target alias/custom domain.",
    );
  const checks = selectServedChecks(assets);
  const urlMapping = Object.fromEntries(checks.map((c) => [c.path, c.urlPath]));
  const missingRoute = origin + "/__native_publisher_missing__";
  const headerEvidence = new Map();
  const report = await verifyServedBytes(
    origin,
    checks.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    {
      ...(attempts === undefined ? {} : { attempts }),
      ...(retryMs === undefined ? {} : { retryDelayMs: retryMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(maxTimeMs === undefined ? {} : { totalTimeoutMs: maxTimeMs }),
      ...(sleep === undefined ? {} : { sleep }),
      urlMapping,
      fetch: async (url, options) => {
        const response = await fetchImpl(url, options);
        try {
          assertTrustedHeaders(response, new URL(url).pathname);
          headerEvidence.set(url, { verified: true });
        } catch {
          headerEvidence.set(url, {
            verified: false,
            reason: "trusted-header-policy-mismatch",
          });
        }
        // The shared byte helper accepts 200 only. For ONE trusted custom-404
        // route require actual 404 first; preserve body/headers for byte proof.
        if (
          url === missingRoute &&
          response.status === 404 &&
          !response.redirected &&
          (!response.url || response.url === url)
        )
          return new Response(response.body, {
            status: 200,
            headers: response.headers,
          });
        if (url === missingRoute && response.status === 200)
          return new Response(response.body, {
            status: 409,
            headers: response.headers,
          }); // same bytes with wrong 200 is NOT custom-404 proof
        return response;
      },
    },
  );
  report.hostingHeaders = report.verified.map((item) => ({
    path: item.path,
    url: item.url,
    ...headerEvidence.get(item.url),
  }));
  report.unverified.push(
    ...assets
      .filter((a) => nonservable(a.path))
      .map((a) => ({
        ...a,
        reason: a.path.startsWith("_worker.js")
          ? "worker-execution-requires-independent-policy-evidence"
          : "hosting-control-requires-trusted-policy-check",
      })),
  );
  // Every servable HTML/manifest/JS/trust/native/WASM/SQLite file was checked.
  // Controls (especially _worker.js) are NOT proven by GET/HTTP200 or source.
  if (report.failures.length) {
    const error = new Error(
      `Served byte mismatch: ${report.failures.map((f) => `${f.path}:${f.reason}`).join(", ")}`,
    );
    error.report = report;
    throw error;
  }
  return report;
}
