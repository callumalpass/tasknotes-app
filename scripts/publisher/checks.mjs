export function assertInventoryCoverage(inventory, sdkTrust) {
  if (
    !inventory.length ||
    new Set(inventory.map((r) => r.path)).size !== inventory.length
  )
    throw Error("Invalid full inventory");
  for (const r of inventory)
    if (
      !r.path ||
      r.path.split("/").some((p) => !p || p === "." || p === "..") ||
      !/^[a-f0-9]{64}$/.test(r.sha256) ||
      !Number.isSafeInteger(r.bytes) ||
      r.bytes < 0 ||
      r.bytes > 25 * 1024 * 1024
    )
      throw Error("Invalid Pages asset");
  for (const path of [
    "index.html",
    "404.html",
    ".well-known/mdbase-app.json",
    "service-worker.js",
    "mdbase-shell-runtime.js",
    "_headers",
    "_redirects",
  ])
    if (!inventory.some((r) => r.path === path))
      throw Error("Missing required publication asset");
  for (const [name, pin] of Object.entries(sdkTrust?.nativeAssets ?? {}))
    if (
      !inventory.some((r) => r.sha256 === pin.sha256 && r.bytes === pin.bytes)
    )
      throw Error("Missing exact SDK native/SQLite original: " + name);
}
export function assertBuiltTarget({ target, manifest }) {
  const origin = {
    staging: "https://staging.tasknotes-app.pages.dev",
    production: "https://app.tasknotes.dev",
  }[target];
  if (
    !origin ||
    manifest.id !== "dev.tasknotes.app" ||
    manifest.homepage !== origin + "/" ||
    manifest.redirect_uris?.length !== 1 ||
    manifest.redirect_uris[0] !== origin + "/auth/mdbase/callback" ||
    manifest.installation_origins?.[target]?.["app-runtime"]?.length !== 1 ||
    manifest.installation_origins[target]["app-runtime"][0] !== origin
  )
    throw Error("Invalid exact TaskNotes web manifest");
}
