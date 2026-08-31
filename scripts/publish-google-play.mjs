import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAY_PACKAGE = "dev.tasknotes.app";
export const PLAY_TRACK = "alpha";
export const PLAY_RELEASE_STATUS = "completed";
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

export function createServiceAccountAssertion(credential, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: credential.clientEmail,
      scope: PLAY_SCOPE,
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
  let message = "Google Play API request failed";
  try {
    const body = await response.json();
    if (typeof body?.error?.message === "string") {
      message = body.error.message;
    } else if (typeof body?.error_description === "string") {
      message = body.error_description;
    }
  } catch {
    // Do not include raw response bodies: they are not needed and may contain
    // more detail than release logs should retain.
  }
  return new Error(`${message} (HTTP ${response.status})`);
}

export async function exchangeAccessToken(
  credential,
  { fetchImpl = fetch, now = Date.now() } = {},
) {
  const assertion = createServiceAccountAssertion(credential, now);
  const response = await fetchImpl(credential.tokenUri, {
    method: "POST",
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
  const response = await fetchImpl(url, { ...options, headers });
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
      `${PLAY_API}/${packagePath}/edits/${encodeURIComponent(editId)}:commit`,
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

async function main() {
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
