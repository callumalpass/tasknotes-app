import { pathToFileURL } from "node:url";

export const PRODUCTION_SDK_REQUIRED =
  "Production SDK release required: replace the LAB-only SDK with an authenticated production SDK containing Callum's production trust asset and packaged native runtime. See docs/releases/next-only-production.md. No LAB fallback is permitted.";

/** Build-time check only: trust remains generated and authenticated by the SDK
 * release pipeline, never manufactured or injected by TaskNotes. */
export function assertProductionSdk(release, selectAssets) {
  if (
    release?.environment !== "production" ||
    release.cpOrigin !== "https://connect.mdbase.dev"
  )
    throw new Error(PRODUCTION_SDK_REQUIRED);
  for (const origin of [
    "https://app.tasknotes.dev",
    "capacitor://app.tasknotes.dev",
  ]) {
    const assets = selectAssets("production", origin);
    if (assets.release().environment !== "production")
      throw new Error(PRODUCTION_SDK_REQUIRED);
  }
}

export async function checkProductionSdk() {
  // Deliberately tied to our pinned SDK artifact. There is no public app trust
  // injection API. Check both the page/Worker artifact and its asset selector.
  const entry = import.meta.resolve("@mdbase-dev/sdk");
  const { appReleaseTrust } = await import(
    new URL("./application/packaged-trust.js", entry).href
  );
  const { packagedApplicationAssets } = await import(
    new URL("./application/packaged-assets.js", entry).href
  );
  assertProductionSdk(appReleaseTrust(), packagedApplicationAssets);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkProductionSdk().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
