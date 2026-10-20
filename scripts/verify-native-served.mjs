import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Pages consumes these files rather than serving them. Still inventory them. */
const CONTROL_FILES = new Set([
  "_headers",
  "_redirects",
  "_routes.json",
  ".nojekyll",
]);

export function selectServedChecks(assets) {
  for (const required of [
    "index.html",
    ".well-known/mdbase-app.json",
    "manifest.webmanifest",
  ]) {
    if (!assets.some((asset) => asset.path === required)) {
      throw new Error(`Missing required served asset ${required}.`);
    }
  }
  if (!assets.some((asset) => asset.path.endsWith(".js"))) {
    throw new Error("Missing JavaScript assets.");
  }
  if (!assets.some((asset) => /runtime[^/]*\.wasm$/.test(asset.path))) {
    throw new Error("Missing native runtime WASM asset.");
  }
  if (!assets.some((asset) => /sqlite[^/]*\.wasm$/.test(asset.path))) {
    throw new Error("Missing SQLite WASM asset.");
  }
  const checks = assets
    .filter((asset) => !CONTROL_FILES.has(asset.path))
    .map((asset) => {
      if (
        !asset.path ||
        asset.path.startsWith("/") ||
        asset.path.includes("\\") ||
        asset.path
          .split("/")
          .some((part) => part === "." || part === ".." || !part) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0
      )
        throw new Error("Invalid asset inventory entry.");
      // Pages canonicalizes *.html and */index.html. Fetch the actual route,
      // not a redirect to an unverified destination (redirects always refuse).
      let path = asset.path;
      if (path === "index.html") path = "";
      else if (path.endsWith("/index.html")) path = path.slice(0, -10);
      else if (path.endsWith(".html")) path = path.slice(0, -5);
      return {
        ...asset,
        urlPath:
          asset.path === "404.html"
            ? "/__native_publisher_missing__"
            : `/${path.split("/").map(encodeURIComponent).join("/")}`,
        status: asset.path === "404.html" ? 404 : 200,
      };
    });
  if (!checks.some((check) => check.urlPath === "/auth/mdbase/callback")) {
    checks.push({
      ...assets.find((asset) => asset.path === "index.html"),
      urlPath: "/auth/mdbase/callback",
      status: 200,
    });
  }
  return checks;
}

/** All public bytes, including any standalone trust assets and every JS chunk
 * (the SDK embeds trust in JS). No credentials, redirects, auth bypass, rebuild,
 * redeploy or rollback. A single deadline includes propagation retries/bodies. */
export async function verifyServedAssets({
  origin,
  assets,
  fetchImpl = fetch,
  sleep = setTimeout,
  attempts = 3,
  retryMs = 1000,
  timeoutMs = 10000,
  maxTimeMs = 300000,
}) {
  if (
    ![
      "https://staging.tasknotes-app.pages.dev",
      "https://app.tasknotes.dev",
    ].includes(origin)
  ) {
    throw new Error(
      "Served verifier requires the real target alias/custom domain.",
    );
  }
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 5 ||
    timeoutMs < 1 ||
    timeoutMs > 30000 ||
    maxTimeMs < 1 ||
    maxTimeMs > 600000 ||
    retryMs < 0 ||
    retryMs > 5000
  ) {
    throw new Error("Invalid bounded verifier limits.");
  }
  const deadline = Date.now() + maxTimeMs;
  const verified = [];
  for (const check of selectServedChecks(assets)) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error("Served verification deadline exceeded.");
      try {
        const response = await fetchImpl(`${origin}${check.urlPath}`, {
          redirect: "manual",
          cache: "no-store",
          credentials: "omit",
          headers: {
            "Cache-Control": "no-cache",
            "Accept-Encoding": "identity",
          },
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
        });
        if (response.status !== check.status) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}, expected ${check.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty response body");
        const hash = createHash("sha256");
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > check.bytes)
              throw new Error("served byte count mismatch (oversized body)");
            hash.update(part.value);
          }
        } finally {
          await reader.cancel();
        }
        if (bytes !== check.bytes || hash.digest("hex") !== check.sha256) {
          throw new Error("served sha256/byte count mismatch");
        }
        verified.push({
          path: check.path,
          urlPath: check.urlPath,
          sha256: check.sha256,
          bytes,
          attempt,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts)
          await sleep(Math.min(retryMs, Math.max(0, deadline - Date.now())));
      }
    }
    if (lastError)
      throw new Error(
        `Served asset mismatch ${check.path} (${check.urlPath}): ${lastError.message}`,
      );
  }
  return { origin, verified, inventorySha256: sha256(JSON.stringify(assets)) };
}
