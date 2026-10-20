// Reviewed static Pages policy, independent of artifact-provided controls.
// No policy mutation. A GET of _worker.js is NOT executed-worker evidence.
import { basename } from "node:path";
import { verifyServedBytes } from "./native-publish-bytes.mjs";
const security = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
};
export function assertTrustedHeaders(response, path) {
  const expected = { ...security };
  if (path === "/.well-known/mdbase-app.json")
    expected["cache-control"] = "no-store";
  if (
    [
      "/service-worker.js",
      "/offline-assets.json",
      "/manifest.webmanifest",
    ].includes(path)
  )
    expected["cache-control"] = "no-cache";
  if (path.startsWith("/assets/"))
    expected["cache-control"] = "public, max-age=31536000, immutable";
  for (const [key, value] of Object.entries(expected))
    if (response.headers.get(key) !== value)
      throw new Error(`Trusted hosting header mismatch: ${key}`);
}
export async function verifyTrustedHostingPolicy({
  origin,
  assets,
  served,
  fetchImpl = fetch,
}) {
  if (
    !served ||
    served.failures.length ||
    served.hostingHeaders.length !== served.verified.length ||
    !served.hostingHeaders.length ||
    served.hostingHeaders.some((e) => e.verified !== true)
  )
    throw new Error("Trusted hosting headers remain unverified.");
  if (
    ![
      "https://staging.tasknotes-app.pages.dev",
      "https://app.tasknotes.dev",
    ].includes(origin)
  )
    throw new Error("Wrong hosting policy target.");
  const index = assets.find((a) => a.path === "index.html");
  const notFound = assets.find((a) => a.path === "404.html");
  if (!index || !notFound)
    throw new Error("Missing HTML for trusted route policy.");
  const routes = [
    "/auth/mdbase/callback",
    "/auth/mdbase/callback/",
    "/more",
    "/more/__native_policy__",
    "/scratchpad",
    "/scratchpad/",
    "/search",
    "/search/",
    "/task/__native_policy__",
    "/views",
    "/views/__native_policy__",
  ];
  const synthetic = routes.map((_, i) => ({
    ...index,
    path: `route-${i}.html`,
  }));
  synthetic.push({ ...notFound, path: "missing.html" });
  const mapping = Object.fromEntries(
    routes.map((route, i) => [`route-${i}.html`, route]),
  );
  mapping["missing.html"] = "/__native_policy_unknown__";
  const result = await verifyServedBytes(origin, synthetic, {
    urlMapping: mapping,
    fetch: async (url, options) => {
      const response = await fetchImpl(url, options);
      assertTrustedHeaders(response, new URL(url).pathname);
      if (
        url === origin + mapping["missing.html"] &&
        response.status === 404 &&
        !response.redirected &&
        (!response.url || response.url === url)
      )
        return new Response(response.body, {
          status: 200,
          headers: response.headers,
        });
      if (url === origin + mapping["missing.html"] && response.status === 200)
        return new Response(response.body, {
          status: 409,
          headers: response.headers,
        });
      return response;
    },
  });
  if (result.failures.length) {
    const error = new Error("Trusted header/route policy readback failed.");
    error.report = result;
    throw error;
  }
  // Source-qualified static behavior: official Wrangler4.114 Pages validate()
  // IGNORE_LIST excludes controls/worker/functions/.git, NOT root .nojekyll.
  // This one existing marker is a normal served asset, never a policy waiver.
  const marker = assets.find((a) => a.path === ".nojekyll");
  if (
    marker &&
    !served.verified.some(
      (a) =>
        a.path === marker.path &&
        a.bytes === marker.bytes &&
        a.sha256 === marker.sha256 &&
        a.url === origin + "/.nojekyll",
    )
  )
    throw new Error("Existing .nojekyll requires actual served-byte evidence.");
  const unverified = assets
    .filter(
      (a) =>
        basename(a.path) === "_routes.json" ||
        (basename(a.path) === ".nojekyll" && a.path !== ".nojekyll") ||
        a.path === "_worker.js" ||
        a.path.startsWith("_worker.js/") ||
        (["_headers", "_redirects"].includes(basename(a.path)) &&
          a.path !== basename(a.path)),
    )
    .map((a) => ({
      ...a,
      reason: "requires-independent-control-or-executed-worker-policy-evidence",
    }));
  return {
    ...result,
    verifiedControls: assets.filter((a) =>
      ["_headers", "_redirects"].includes(a.path),
    ),
    unverified,
  };
}
