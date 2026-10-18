import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRODUCTION_TRUST_PIN = "vendor/production-trust.pin.json";
export const PRODUCTION_CP_ORIGIN = "https://connect.mdbase.dev";
export const PRODUCTION_SDK_REQUIRED =
  "Production SDK release required: the installed @mdbase-dev/sdk must be the production-packaged release that embeds the trust asset pinned in vendor/production-trust.pin.json. See docs/releases/next-only-production.md. No LAB fallback is permitted.";

const HEX64 = /^[0-9a-f]{64}$/;

function refuse(reason) {
  return new Error(`${PRODUCTION_SDK_REQUIRED}\nReason: ${reason}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The pin is the single named input for production trust. Every field must
 * be present: there is no default, environment override or LAB fallback. */
export function assertProductionTrustPin(pin) {
  if (!pin || pin.schema !== "tasknotes/production-trust-pin/1")
    throw refuse(`${PRODUCTION_TRUST_PIN} is missing or has the wrong schema`);
  if (pin.environment !== "production" || pin.cpOrigin !== PRODUCTION_CP_ORIGIN)
    throw refuse(
      `${PRODUCTION_TRUST_PIN} must name production at ${PRODUCTION_CP_ORIGIN}`,
    );
  if (
    typeof pin.trustAssetSha256 !== "string" ||
    !HEX64.test(pin.trustAssetSha256)
  )
    throw refuse(`${PRODUCTION_TRUST_PIN} trustAssetSha256 is not set`);
  let log;
  try {
    log = new URL(pin.logOrigin);
  } catch {
    throw refuse(`${PRODUCTION_TRUST_PIN} logOrigin is not set`);
  }
  if (log.protocol !== "https:" || log.origin !== pin.logOrigin)
    throw refuse(
      `${PRODUCTION_TRUST_PIN} logOrigin must be an exact HTTPS origin`,
    );
  if (typeof pin.sdkPin !== "string" || !/^[\w.-]+\.json$/.test(pin.sdkPin))
    throw refuse(`${PRODUCTION_TRUST_PIN} sdkPin is not set`);
  return pin;
}

/** Static inspection of the installed SDK's generated release files. The SDK's
 * asset selector is bound to a browser or Worker origin, so it is never called
 * from Node here; browser-context selection is qualified separately. */
export function assertPackagedSdk(pin, files) {
  if (files.packagedTrust.includes("application_release_trust_unavailable"))
    throw refuse(
      "the installed SDK has no packaged release trust (source-only build)",
    );
  const match = /^const metadata = (\{.*\});$/m.exec(files.packagedTrust);
  let metadata;
  try {
    metadata = JSON.parse(match?.[1] ?? "");
  } catch {
    throw refuse(
      "the installed SDK release trust module is not the canonical generated form",
    );
  }
  let provenance;
  try {
    provenance = JSON.parse(files.provenance ?? "");
  } catch {
    throw refuse("the installed SDK has no packaged native provenance");
  }
  const checks = [
    ["release schema", metadata.schema, "mdbn-app-trust/release/1"],
    ["release environment", metadata.environment, "production"],
    ["release control plane", metadata.cpOrigin, pin.cpOrigin],
    ["release log origin", metadata.logOrigin, pin.logOrigin],
    ["release trust digest", metadata.assetSha256, pin.trustAssetSha256],
    ["provenance schema", provenance.schema, "mdbn-sdk/application-assets/1"],
    ["provenance environment", provenance.environment, "production"],
    [
      "provenance trust environment",
      provenance.trust?.environment,
      "production",
    ],
    ["provenance control plane", provenance.trust?.cpOrigin, pin.cpOrigin],
    ["provenance log origin", provenance.trust?.logOrigin, pin.logOrigin],
    ["provenance trust digest", provenance.trust?.sha256, pin.trustAssetSha256],
    ["verifier clock override", provenance.verifier?.clockOverride, false],
  ];
  for (const [name, actual, expected] of checks)
    if (actual !== expected)
      throw refuse(`${name} does not match the production pin`);
  for (const [name, bytes, expected] of [
    ["runtime.wasm", files.runtime, files.assetPins?.runtime],
    ["sqlite3.wasm", files.sqlite, files.assetPins?.sqlite],
    [
      "sqlite3.js",
      files.sqliteInitializer,
      files.assetPins?.sqlite?.initializer,
    ],
  ]) {
    if (
      !bytes ||
      !expected ||
      bytes.byteLength !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    )
      throw refuse(`packaged ${name} does not match the SDK's committed pin`);
  }
  return metadata;
}

/** The app depends on exactly the archive the production SDK pin names. */
export function assertSdkDependency(pin, sdkPin, packageJson, archive) {
  if (
    !sdkPin ||
    typeof sdkPin.artifact !== "string" ||
    !HEX64.test(sdkPin.sha256 ?? "")
  )
    throw refuse(`vendor/${pin.sdkPin} is not a valid SDK pin`);
  if (
    packageJson.dependencies?.["@mdbase-dev/sdk"] !==
    `file:vendor/${sdkPin.artifact}`
  )
    throw refuse(
      `package.json does not depend on the pinned SDK archive ${sdkPin.artifact}`,
    );
  if (!archive || sha256(archive) !== sdkPin.sha256)
    throw refuse(`vendor/${sdkPin.artifact} does not match its pin`);
}

function readOptional(path) {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

export async function checkProductionSdk(
  root = new URL("../", import.meta.url),
) {
  const read = (path) => readOptional(fileURLToPath(new URL(path, root)));
  const parse = (bytes) => {
    try {
      return bytes ? JSON.parse(bytes.toString("utf8")) : undefined;
    } catch {
      return undefined;
    }
  };
  const pin = assertProductionTrustPin(parse(read(PRODUCTION_TRUST_PIN)));
  const sdkPin = parse(read(`vendor/${pin.sdkPin}`));
  const archive = sdkPin?.artifact
    ? read(`vendor/${sdkPin.artifact}`)
    : undefined;
  assertSdkDependency(pin, sdkPin, parse(read("package.json")) ?? {}, archive);
  const sdkDist = dirname(
    fileURLToPath(import.meta.resolve("@mdbase-dev/sdk")),
  );
  const dist = (path) => readOptional(join(sdkDist, path));
  return assertPackagedSdk(pin, {
    packagedTrust:
      dist("application/packaged-trust.js")?.toString("utf8") ?? "",
    provenance: dist("native/provenance.json")?.toString("utf8"),
    assetPins: parse(dist("application/asset-pins.json")),
    runtime: dist("native/runtime.wasm"),
    sqlite: dist("native/sqlite3.wasm"),
    sqliteInitializer: dist("native/sqlite3.js"),
  });
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
