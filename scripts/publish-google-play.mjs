import { createSign } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAY_PACKAGE = "dev.tasknotes.app";
export const PLAY_TRACK = "alpha";
export const PLAY_RELEASE_STATUS = "completed";
// Production always starts at 10%; post-release failures halt the same
// version. Never silently fall back to a full rollout if staging is refused.
export const PLAY_PRODUCTION_TRACK = "production";
export const PLAY_PRODUCTION_RELEASE_STATUS = "inProgress";
export const PLAY_PRODUCTION_FRACTION = 0.1;
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const PLAY_UPLOAD_API =
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function parseServiceAccount(encodedCredential) {
  const encoded = requiredString(
    encodedCredential,
    "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64",
  );
  let credential;
  try {
    credential = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error(
      "Google Play service-account credential is not valid base64 JSON",
    );
  }

  if (credential.type !== "service_account") {
    throw new Error("Google Play credential must have type service_account");
  }
  const clientEmail = requiredString(credential.client_email, "client_email");
  if (!clientEmail.endsWith(".iam.gserviceaccount.com")) {
    throw new Error(
      "Google Play credential has an invalid service-account email",
    );
  }
  const privateKey = requiredString(credential.private_key, "private_key");
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("Google Play credential has an invalid private key");
  }
  if (credential.token_uri !== "https://oauth2.googleapis.com/token") {
    throw new Error("Google Play credential has an unexpected token endpoint");
  }

  return { clientEmail, privateKey, tokenUri: credential.token_uri };
}

export function createServiceAccountAssertion(
  credential,
  now = Date.now(),
  scope = PLAY_SCOPE,
) {
  if (
    ![
      PLAY_SCOPE,
      "https://www.googleapis.com/auth/playdeveloperreporting",
    ].includes(scope)
  )
    throw new Error("Unsupported Google API scope");
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: credential.clientEmail,
      scope,
      aud: credential.tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(credential.privateKey, "base64url")}`;
}

async function responseError(response) {
  // Never emit store payloads/account identifiers into Actions logs.
  return new Error(`Google Play API request failed (HTTP ${response.status})`);
}

export async function exchangeAccessToken(
  credential,
  { fetchImpl = fetch, now = Date.now(), scope = PLAY_SCOPE } = {},
) {
  const assertion = createServiceAccountAssertion(credential, now, scope);
  const response = await fetchImpl(credential.tokenUri, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json();
  return requiredString(body.access_token, "Google OAuth access_token");
}

function validateVersionCode(value) {
  const versionCode = Number(value);
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2_100_000_000
  ) {
    throw new Error(
      "Expected Android version code must be an integer from 1 to 2100000000",
    );
  }
  return versionCode;
}

function releaseName(value) {
  const name = requiredString(value, "release name").trim();
  if (!/^TaskNotes \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(name)) {
    throw new Error("Release name must be 'TaskNotes <semantic version>'");
  }
  return name;
}

async function playRequest(fetchImpl, token, url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    ...options,
    headers,
  });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined;
  return response.json();
}

function isExactClosedTestTrack(track, versionCode, name) {
  if (track?.track !== PLAY_TRACK || track?.releases?.length !== 1)
    return false;
  const release = track.releases[0];
  return (
    release?.name === name &&
    release?.status === PLAY_RELEASE_STATUS &&
    Array.isArray(release?.versionCodes) &&
    release.versionCodes.length === 1 &&
    release.versionCodes[0] === String(versionCode) &&
    release.userFraction === undefined &&
    release.countryTargeting === undefined
  );
}

function isExactProductionTrack(
  track,
  versionCode,
  name,
  allowCompleted = true,
) {
  if (track?.track !== PLAY_PRODUCTION_TRACK) return false;
  const releases = track.releases ?? [];
  const matching = releases.filter((release) =>
    release?.versionCodes?.includes(String(versionCode)),
  );
  if (matching.length !== 1) return false;
  const release = matching[0];
  return (
    release?.name === name &&
    ((allowCompleted &&
      release?.status === "completed" &&
      release.userFraction === undefined) ||
      (release?.status === PLAY_PRODUCTION_RELEASE_STATUS &&
        release.userFraction === PLAY_PRODUCTION_FRACTION)) &&
    release.versionCodes.length === 1 &&
    release.countryTargeting === undefined &&
    // Play keeps only the newest completed production release on the track.
    releases.every(
      (other) =>
        other === release ||
        (other?.versionCodes ?? []).every((code) => Number(code) < versionCode),
    )
  );
}

function closedTestReleaseForPromotion(track, versionCode, name) {
  const matching = (track?.releases ?? []).filter((release) =>
    release?.versionCodes?.includes(String(versionCode)),
  );
  if (matching.length !== 1) {
    throw new Error(
      `Version code ${versionCode} is not on the Google Play closed-testing track (${PLAY_TRACK})`,
    );
  }
  const release = matching[0];
  if (
    release.status !== PLAY_RELEASE_STATUS ||
    release.versionCodes.length !== 1 ||
    release.name !== name
  ) {
    throw new Error(
      `Version code ${versionCode} is not a completed '${name}' closed-test release`,
    );
  }
  return release;
}

function assertProductionAcceptsVersion(track, versionCode) {
  for (const release of track?.releases ?? []) {
    if (release?.status !== "completed") {
      throw new Error(
        `Google Play production already has a ${release?.status ?? "unknown"} release; resolve it in Play Console first`,
      );
    }
    if (
      (release.versionCodes ?? []).some((code) => Number(code) >= versionCode)
    ) {
      throw new Error(
        `Google Play production already contains version code ${versionCode} or a higher release in a different state`,
      );
    }
  }
}

function trackContainsVersion(track, versionCode) {
  return Boolean(
    track?.releases?.some((release) =>
      release?.versionCodes?.includes(String(versionCode)),
    ),
  );
}

export async function publishClosedTest({
  credentialBase64,
  aabPath,
  expectedVersionCode,
  name,
  fetchImpl = fetch,
  readFileImpl = readFile,
  now = Date.now(),
}) {
  const versionCode = validateVersionCode(expectedVersionCode);
  const validatedName = releaseName(name);
  const credential = parseServiceAccount(credentialBase64);
  const token = await exchangeAccessToken(credential, { fetchImpl, now });
  const packagePath = `applications/${PLAY_PACKAGE}`;
  let editId;

  try {
    const edit = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits`,
      { method: "POST", body: "{}" },
    );
    editId = requiredString(edit.id, "Google Play edit id");

    const tracks = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}/tracks`,
    );
    const existingTrack = tracks?.tracks?.find(
      (track) => track?.track === PLAY_TRACK,
    );
    if (isExactClosedTestTrack(existingTrack, versionCode, validatedName)) {
      return {
        packageName: PLAY_PACKAGE,
        track: PLAY_TRACK,
        versionCode,
        alreadyPublished: true,
      };
    }
    if (trackContainsVersion(existingTrack, versionCode)) {
      throw new Error(
        "Google Play already contains this version code in a different closed-test state",
      );
    }

    const bundle = await readFileImpl(resolve(aabPath));
    if (!Buffer.isBuffer(bundle) || bundle.length === 0) {
      throw new Error("Android App Bundle is empty");
    }
    const uploaded = await playRequest(
      fetchImpl,
      token,
      `${PLAY_UPLOAD_API}/${packagePath}/edits/${encodeURIComponent(editId)}/bundles?uploadType=media`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bundle,
      },
    );
    if (Number(uploaded.versionCode) !== versionCode) {
      throw new Error(
        `Uploaded bundle version code ${uploaded.versionCode} did not match expected ${versionCode}`,
      );
    }

    const track = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}/tracks/${PLAY_TRACK}`,
      {
        method: "PUT",
        body: JSON.stringify({
          track: PLAY_TRACK,
          releases: [
            {
              name: validatedName,
              versionCodes: [String(versionCode)],
              status: PLAY_RELEASE_STATUS,
              releaseNotes: [{ language: "en-US", text: `${validatedName}.` }],
            },
          ],
        }),
      },
    );
    if (!isExactClosedTestTrack(track, versionCode, validatedName)) {
      throw new Error(
        "Google Play did not return the required closed-test release state",
      );
    }

    await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}:validate`,
      { method: "POST", body: "{}" },
    );
    await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`,
      { method: "POST", body: "{}" },
    );
    editId = undefined;
    return {
      packageName: PLAY_PACKAGE,
      track: PLAY_TRACK,
      versionCode,
      alreadyPublished: false,
    };
  } finally {
    if (editId) {
      try {
        await playRequest(
          fetchImpl,
          token,
          `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}`,
          { method: "DELETE" },
        );
      } catch {
        // An abandoned edit expires automatically. Preserve the original error.
      }
    }
  }
}

export async function promoteToProduction({
  credentialBase64,
  expectedVersionCode,
  name,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const versionCode = validateVersionCode(expectedVersionCode);
  const validatedName = releaseName(name);
  const credential = parseServiceAccount(credentialBase64);
  const token = await exchangeAccessToken(credential, { fetchImpl, now });
  const packagePath = `applications/${PLAY_PACKAGE}`;
  let editId;

  try {
    const edit = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits`,
      { method: "POST", body: "{}" },
    );
    editId = requiredString(edit.id, "Google Play edit id");

    const tracks = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}/tracks`,
    );
    const productionTrack = tracks?.tracks?.find(
      (track) => track?.track === PLAY_PRODUCTION_TRACK,
    );
    if (isExactProductionTrack(productionTrack, versionCode, validatedName)) {
      return {
        packageName: PLAY_PACKAGE,
        track: PLAY_PRODUCTION_TRACK,
        versionCode,
        alreadyPublished: true,
      };
    }
    assertProductionAcceptsVersion(productionTrack, versionCode);

    const closedTestTrack = tracks?.tracks?.find(
      (track) => track?.track === PLAY_TRACK,
    );
    const closedTestRelease = closedTestReleaseForPromotion(
      closedTestTrack,
      versionCode,
      validatedName,
    );

    const productionRelease = {
      name: validatedName,
      versionCodes: [String(versionCode)],
      status: PLAY_PRODUCTION_RELEASE_STATUS,
      userFraction: PLAY_PRODUCTION_FRACTION,
    };
    if (
      Array.isArray(closedTestRelease.releaseNotes) &&
      closedTestRelease.releaseNotes.length > 0
    ) {
      productionRelease.releaseNotes = closedTestRelease.releaseNotes;
    }

    const track = await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}/tracks/${PLAY_PRODUCTION_TRACK}`,
      {
        method: "PUT",
        body: JSON.stringify({
          track: PLAY_PRODUCTION_TRACK,
          releases: [...(productionTrack?.releases ?? []), productionRelease],
        }),
      },
    );
    if (!isExactProductionTrack(track, versionCode, validatedName, false)) {
      throw new Error(
        "Google Play did not return the required production release state",
      );
    }

    await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}:validate`,
      { method: "POST", body: "{}" },
    );
    await playRequest(
      fetchImpl,
      token,
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`,
      { method: "POST", body: "{}" },
    );
    editId = undefined;
    return {
      packageName: PLAY_PACKAGE,
      track: PLAY_PRODUCTION_TRACK,
      versionCode,
      alreadyPublished: false,
    };
  } finally {
    if (editId) {
      try {
        await playRequest(
          fetchImpl,
          token,
          `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}`,
          { method: "DELETE" },
        );
      } catch {
        // An abandoned edit expires automatically. Preserve the original error.
      }
    }
  }
}

/** Reconcile one staged version, preserving previous completed releases.
 * No upload, automatic retry, downgrade, or full-rollout fallback. */
export async function setProductionRollout({
  credentialBase64,
  expectedVersionCode,
  status,
  userFraction,
  expectedFraction,
  fetchImpl = fetch,
}) {
  const versionCode = String(validateVersionCode(expectedVersionCode));
  if (
    !["halted", "completed", "inProgress"].includes(status) ||
    (status === "inProgress" &&
      (userFraction !== 0.5 || expectedFraction !== 0.1)) ||
    (status === "completed" && expectedFraction !== 0.5)
  )
    throw new Error("Only halt, widen 10% to 50%, or complete 50% rollout");
  const token = await exchangeAccessToken(
    parseServiceAccount(credentialBase64),
    { fetchImpl },
  );
  const root = `${PLAY_API}/applications/${PLAY_PACKAGE}/edits`;
  let editId;
  try {
    editId = requiredString(
      (
        await playRequest(fetchImpl, token, root, {
          method: "POST",
          body: "{}",
        })
      ).id,
      "edit id",
    );
    const url = `${root}/${encodeURIComponent(editId)}/tracks/production`;
    const track = await playRequest(fetchImpl, token, url);
    const releases = track.releases ?? [];
    const selected = releases.filter((r) =>
      r.versionCodes?.includes(versionCode),
    );
    if (selected.length !== 1 || selected[0].versionCodes.length !== 1)
      throw new Error("Exact staged version not found");
    const release = selected[0];
    if (
      release.status === status &&
      (status !== "inProgress" || release.userFraction === userFraction)
    )
      return { status, versionCode, alreadyApplied: true };
    if (
      release.status !== "inProgress" ||
      (status !== "halted" && release.userFraction !== expectedFraction) ||
      releases.some((r) => r !== release && r.status !== "completed")
    )
      throw new Error("Production rollout cannot be reconciled automatically");
    const updated = { ...release, status };
    if (status === "completed") delete updated.userFraction;
    if (status === "inProgress") updated.userFraction = userFraction;
    const next = {
      track: "production",
      releases: releases.map((r) => (r === release ? updated : r)),
    };
    const saved = await playRequest(fetchImpl, token, url, {
      method: "PUT",
      body: JSON.stringify(next),
    });
    if (!isDeepStrictEqual(saved.releases, next.releases))
      throw new Error("Production rollout readback mismatch");
    await playRequest(
      fetchImpl,
      token,
      `${root}/${encodeURIComponent(editId)}:validate`,
      { method: "POST", body: "{}" },
    );
    await playRequest(
      fetchImpl,
      token,
      `${root}/${encodeURIComponent(editId)}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`,
      { method: "POST", body: "{}" },
    );
    editId = undefined;
    return { status, versionCode, alreadyApplied: false };
  } finally {
    if (editId)
      await playRequest(
        fetchImpl,
        token,
        `${root}/${encodeURIComponent(editId)}`,
        { method: "DELETE" },
      );
  }
}

export const PROMOTE_PRODUCTION_FLAG = "--promote-production";

async function promoteProductionMain(args) {
  if (args.length !== 2) {
    throw new Error(
      `Usage: publish-google-play.mjs ${PROMOTE_PRODUCTION_FLAG} <version code> <version name>`,
    );
  }
  const [expectedVersionCode, versionName] = args;
  const qualified = JSON.parse(
    await readFile("mobile-release-qualified.json", "utf8"),
  );
  if (qualified.version !== versionName || !qualified.sourceRunId)
    throw new Error("Qualified mobile source required before promotion");
  const result = await promoteToProduction({
    credentialBase64: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
    expectedVersionCode,
    name: `TaskNotes ${requiredString(versionName, "version name")}`,
  });
  await writeFile(
    "mobile-production-result.json",
    JSON.stringify(
      {
        ...result,
        source: qualified.source,
        sourceRunId: qualified.sourceRunId,
        promotedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  const action = result.alreadyPublished ? "Verified" : "Promoted";
  console.log(
    `${action} ${result.packageName} version code ${result.versionCode} on Google Play production (${result.track}).`,
  );
}

async function main() {
  if (process.argv[2] === PROMOTE_PRODUCTION_FLAG) {
    return promoteProductionMain(process.argv.slice(3));
  }
  const [aabPath, expectedVersionCode, versionName] = process.argv.slice(2);
  const result = await publishClosedTest({
    credentialBase64: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
    aabPath: requiredString(aabPath, "AAB path"),
    expectedVersionCode,
    name: `TaskNotes ${requiredString(versionName, "version name")}`,
  });
  const action = result.alreadyPublished ? "Verified" : "Published";
  console.log(
    `${action} ${result.packageName} version code ${result.versionCode} on Google Play closed testing (${result.track}).`,
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Google Play publication failed",
    );
    process.exitCode = 1;
  });
}
