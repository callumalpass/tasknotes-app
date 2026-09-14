import { sign } from "node:crypto";
import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ID = "6797168033";
export const BUNDLE_ID = "dev.tasknotes.app";
const API = "https://api.appstoreconnect.apple.com/v1/";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const relation = (type, id) => ({ data: { type, id } });
const state = (version) => version.attributes.appStoreState;
const releasedStates = new Set(["READY_FOR_SALE", "REPLACED_WITH_NEW_VERSION"]);
const submittedStates = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
]);

function requireValue(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required`);
  return value.trim();
}

export function validateMetadata(metadata, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Public releases require a three-part numeric version");
  if (metadata.version !== version)
    throw new Error("Release metadata version does not match the build");
  requireValue(metadata.copyright, "copyright");
  const reviewNotes = requireValue(metadata.reviewNotes, "reviewNotes");
  if (reviewNotes.length > 4000)
    throw new Error("Review notes exceed 4000 characters");
  if (
    !metadata.whatsNew ||
    typeof metadata.whatsNew !== "object" ||
    Array.isArray(metadata.whatsNew)
  ) {
    throw new Error("whatsNew must map each store locale to release notes");
  }
  const locales = Object.keys(metadata.whatsNew);
  if (!locales.length) throw new Error("At least one store locale is required");
  for (const locale of locales) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(locale))
      throw new Error("Invalid store locale");
    if (
      requireValue(metadata.whatsNew[locale], `whatsNew.${locale}`).length >
      4000
    ) {
      throw new Error("Release notes exceed 4000 characters");
    }
  }
  return metadata;
}

export function createToken({ keyId, issuerId, privateKey }, now = Date.now()) {
  const encode = (object) =>
    Buffer.from(JSON.stringify(object)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode(
    {
      iss: issuerId,
      iat: Math.floor(now / 1000) - 30,
      exp: Math.floor(now / 1000) + 600,
      aud: "appstoreconnect-v1",
    },
  )}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${signature.toString("base64url")}`;
}

export function createClient(
  credentials,
  { fetchImpl = fetch, sleepImpl = sleep } = {},
) {
  async function request(path, method = "GET", data) {
    const url = new URL(path, API);
    // Pagination must never send our bearer token to an arbitrary host.
    if (
      url.origin !== new URL(API).origin ||
      !url.pathname.startsWith("/v1/")
    ) {
      throw new Error("Unexpected App Store Connect URL");
    }
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
        headers: {
          authorization: `Bearer ${createToken(credentials)}`,
          "content-type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify({ data }),
      });
      // Writes are not blindly retried: rerun the job to reconcile actual server state.
      if (
        method === "GET" &&
        attempt < 4 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await sleepImpl(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const codes =
          body.errors?.map((error) => error.code).join(", ") || "unknown";
        throw new Error(
          `App Store Connect ${method} ${url.pathname}: HTTP ${response.status} (${codes}). Check the listing in App Store Connect; no automatic cancellation or replacement was attempted.`,
        );
      }
      return response.status === 204 ? {} : response.json();
    }
  }
  async function list(path) {
    const result = [];
    const seen = new Set();
    while (path) {
      if (seen.has(path)) throw new Error("Repeated pagination URL");
      seen.add(path);
      const page = await request(path);
      result.push(...page.data);
      path = page.links?.next;
    }
    return result;
  }
  return { request, list };
}

export async function waitForBuild(
  client,
  version,
  buildNumber,
  { attempts = 60, sleepImpl = sleep } = {},
) {
  if (!/^[1-9]\d*$/.test(buildNumber))
    throw new Error("Expected a positive build number");
  const query = new URLSearchParams({
    "filter[app]": APP_ID,
    "filter[version]": buildNumber,
    "filter[preReleaseVersion.version]": version,
    "filter[preReleaseVersion.platform]": "IOS",
  });
  for (let attempt = 0; attempt < attempts; attempt++) {
    const builds = await client.list(`builds?${query}`);
    if (builds.length > 1)
      throw new Error(
        "Multiple builds matched the exact version and build number",
      );
    const build = builds[0];
    if (build) {
      const a = build.attributes;
      if (
        a.version !== buildNumber ||
        a.expired ||
        ["FAILED", "INVALID"].includes(a.processingState)
      ) {
        throw new Error("Selected build is invalid, expired, or mismatched");
      }
      if (a.processingState === "VALID") {
        if (
          a.buildAudienceType !== "APP_STORE_ELIGIBLE" ||
          a.usesNonExemptEncryption == null
        ) {
          throw new Error(
            "Build needs App Store eligibility or an export-compliance declaration; resolve in App Store Connect",
          );
        }
        return build;
      }
    }
    if (attempt + 1 < attempts) await sleepImpl(30_000);
  }
  throw new Error(
    "Timed out waiting for the exact build to finish processing; rerun only the submission job later",
  );
}

function assertLocales(localizations, metadata) {
  const actual = localizations.map((item) => item.attributes.locale).sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(Object.keys(metadata.whatsNew).sort())
  ) {
    throw new Error(
      "Release notes must cover exactly all existing store locales; configure new locales in App Store Connect first",
    );
  }
}

export async function submitAppStore({
  client,
  version,
  buildNumber,
  metadata,
  commit = false,
  waitOptions,
}) {
  validateMetadata(metadata, version);
  const app = (await client.request(`apps/${APP_ID}`)).data;
  if (app.attributes.bundleId !== BUNDLE_ID)
    throw new Error("Unexpected app bundle ID");
  const build = await waitForBuild(client, version, buildNumber, waitOptions);
  const versions = await client.list(
    `apps/${APP_ID}/appStoreVersions?filter[platform]=IOS`,
  );
  let target = versions.find(
    (item) => item.attributes.versionString === version,
  );
  const current = versions.find((item) => state(item) === "READY_FOR_SALE");
  if (!current)
    throw new Error(
      "This workflow updates an existing public app; the initial listing requires manual setup",
    );
  if (target) {
    const linked = (
      await client.request(`appStoreVersions/${target.id}/relationships/build`)
    ).data;
    if (linked && linked.id !== build.id)
      throw new Error(
        "Store version is attached to a different build; refusing to replace it",
      );
    if (
      submittedStates.has(state(target)) ||
      releasedStates.has(state(target))
    ) {
      if (
        !linked ||
        (!releasedStates.has(state(target)) &&
          target.attributes.releaseType !== "AFTER_APPROVAL")
      ) {
        throw new Error(
          "Existing submitted version does not match the expected release policy",
        );
      }
      return {
        version,
        buildNumber,
        versionId: target.id,
        state: state(target),
        alreadySubmitted: true,
      };
    }
    if (
      !["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"].includes(state(target))
    ) {
      throw new Error(`Store version needs manual attention: ${state(target)}`);
    }
  }
  if (
    versions.some(
      (item) => item.id !== target?.id && !releasedStates.has(state(item)),
    )
  ) {
    throw new Error(
      "Another iOS store version is in flight; refusing to modify or cancel it",
    );
  }
  const sourceId = target?.id ?? current.id;
  const localizations = await client.list(
    `appStoreVersions/${sourceId}/appStoreVersionLocalizations`,
  );
  assertLocales(localizations, metadata);
  const review = (
    await client.request(`appStoreVersions/${sourceId}/appStoreReviewDetail`)
  ).data;
  if (
    !review ||
    !review.attributes.contactEmail ||
    !review.attributes.contactFirstName ||
    !review.attributes.contactLastName ||
    !review.attributes.contactPhone
  ) {
    throw new Error(
      "App review contact information is incomplete; configure it in App Store Connect",
    );
  }
  const submissions = await client.list(
    `reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS`,
  );
  const active = submissions.filter(
    (item) => item.attributes.state !== "COMPLETE",
  );
  if (
    active.length > 1 ||
    active.some((item) => item.attributes.state !== "READY_FOR_REVIEW")
  ) {
    throw new Error(
      "Another review submission is active or needs manual attention",
    );
  }
  let submission = active[0];
  let items = submission
    ? await client.list(
        `reviewSubmissions/${submission.id}/items?include=appStoreVersion`,
      )
    : [];
  if (
    items.some(
      (item) =>
        !target || item.relationships?.appStoreVersion?.data?.id !== target.id,
    ) ||
    items.length > 1
  ) {
    throw new Error(
      "Draft review submission contains unrelated items; refusing to submit them",
    );
  }
  if (!commit)
    return {
      version,
      buildNumber,
      state: "DRY_RUN",
      wouldCreateVersion: !target,
    };

  if (!target) {
    target = (
      await client.request("appStoreVersions", "POST", {
        type: "appStoreVersions",
        attributes: {
          platform: "IOS",
          versionString: version,
          copyright: metadata.copyright,
          releaseType: "AFTER_APPROVAL",
        },
        relationships: { app: relation("apps", APP_ID) },
      })
    ).data;
  }
  if (state(target) === "PREPARE_FOR_SUBMISSION") {
    await client.request(`appStoreVersions/${target.id}`, "PATCH", {
      type: "appStoreVersions",
      id: target.id,
      attributes: {
        copyright: metadata.copyright,
        releaseType: "AFTER_APPROVAL",
        earliestReleaseDate: null,
      },
      relationships: { build: relation("builds", build.id) },
    });
    // Apple inherits listing text, screenshots and review contacts when creating an update.
    // Verify inheritance rather than fabricating contact credentials or legal declarations.
    const inherited = await client.list(
      `appStoreVersions/${target.id}/appStoreVersionLocalizations`,
    );
    assertLocales(inherited, metadata);
    for (const locale of inherited) {
      await client.request(
        `appStoreVersionLocalizations/${locale.id}`,
        "PATCH",
        {
          type: "appStoreVersionLocalizations",
          id: locale.id,
          attributes: { whatsNew: metadata.whatsNew[locale.attributes.locale] },
        },
      );
    }
    const detail = (
      await client.request(`appStoreVersions/${target.id}/appStoreReviewDetail`)
    ).data;
    if (!detail)
      throw new Error(
        "Apple did not inherit review details; configure them before rerunning",
      );
    await client.request(`appStoreReviewDetails/${detail.id}`, "PATCH", {
      type: "appStoreReviewDetails",
      id: detail.id,
      attributes: { notes: metadata.reviewNotes },
    });
  }
  // Read back durable state before the irreversible submission step (also on reruns).
  const prepared = (await client.request(`appStoreVersions/${target.id}`)).data;
  const attached = (
    await client.request(`appStoreVersions/${target.id}/relationships/build`)
  ).data;
  const savedLocales = await client.list(
    `appStoreVersions/${target.id}/appStoreVersionLocalizations`,
  );
  const savedReview = (
    await client.request(`appStoreVersions/${target.id}/appStoreReviewDetail`)
  ).data;
  assertLocales(savedLocales, metadata);
  if (
    attached?.id !== build.id ||
    prepared.attributes.releaseType !== "AFTER_APPROVAL" ||
    prepared.attributes.earliestReleaseDate ||
    savedLocales.some(
      (item) =>
        item.attributes.whatsNew !== metadata.whatsNew[item.attributes.locale],
    ) ||
    savedReview.attributes.notes !== metadata.reviewNotes
  ) {
    throw new Error(
      "Saved release metadata/build does not match the requested submission",
    );
  }
  // A phased release must never be silently retained or changed.
  const phased = await client.request(
    `appStoreVersions/${target.id}/relationships/appStoreVersionPhasedRelease`,
  );
  if (phased.data)
    throw new Error(
      "A phased release is configured; remove it manually to release to everyone after approval",
    );
  if (!submission) {
    submission = (
      await client.request("reviewSubmissions", "POST", {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: relation("apps", APP_ID) },
      })
    ).data;
  }
  if (!items.length) {
    await client.request("reviewSubmissionItems", "POST", {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: relation("reviewSubmissions", submission.id),
        appStoreVersion: relation("appStoreVersions", target.id),
      },
    });
  }
  items = await client.list(
    `reviewSubmissions/${submission.id}/items?include=appStoreVersion`,
  );
  if (
    items.length !== 1 ||
    items[0].relationships?.appStoreVersion?.data?.id !== target.id
  ) {
    throw new Error("Review submission items changed; refusing to submit");
  }
  await client.request(`reviewSubmissions/${submission.id}`, "PATCH", {
    type: "reviewSubmissions",
    id: submission.id,
    attributes: { submitted: true },
  });
  const confirmed = (await client.request(`appStoreVersions/${target.id}`))
    .data;
  if (
    !submittedStates.has(state(confirmed)) &&
    !releasedStates.has(state(confirmed))
  ) {
    throw new Error(
      "Apple has not yet confirmed submission; inspect App Store Connect or rerun the submission job",
    );
  }
  return {
    version,
    buildNumber,
    versionId: target.id,
    submissionId: submission.id,
    state: state(confirmed),
    alreadySubmitted: false,
  };
}

async function main() {
  const version = requireValue(
    process.env.TASKNOTES_IOS_VERSION,
    "TASKNOTES_IOS_VERSION",
  );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid public release version");
  const metadata = validateMetadata(
    JSON.parse(await readFile(`docs/releases/ios/${version}.json`, "utf8")),
    version,
  );
  if (process.argv.includes("--validate")) return;
  const client = createClient({
    keyId: requireValue(
      process.env.APP_STORE_PUBLISH_KEY_ID,
      "APP_STORE_PUBLISH_KEY_ID",
    ),
    issuerId: requireValue(
      process.env.APP_STORE_PUBLISH_ISSUER_ID,
      "APP_STORE_PUBLISH_ISSUER_ID",
    ),
    privateKey: Buffer.from(
      requireValue(
        process.env.APP_STORE_PUBLISH_PRIVATE_KEY_BASE64,
        "APP_STORE_PUBLISH_PRIVATE_KEY_BASE64",
      ),
      "base64",
    ).toString("utf8"),
  });
  const result = await submitAppStore({
    client,
    version,
    buildNumber: process.env.TASKNOTES_IOS_BUILD,
    metadata,
    commit: process.argv.includes("--submit"),
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## App Store submission\n\nVersion **${result.version}**, build **${result.buildNumber}**: **${result.state}**.\n\n[App Store Connect](https://appstoreconnect.apple.com/apps/${APP_ID}/distribution)\n\nApple review is required. Submission is not proof of public availability.\n`,
    );
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
