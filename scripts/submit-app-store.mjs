import { sign } from "node:crypto";
import { readFile, appendFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStoreListing } from "./store-listing.mjs";
import { loadStoreMedia } from "./store-media.mjs";

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
  "PENDING_DEVELOPER_RELEASE",
]);

// A refusal carries a fixed slug chosen where it is thrown, so the bounded
// receipt never depends on (or reveals) the message text.
function refuse(message, reason, options) {
  return Object.assign(new Error(message, options), { refusal: reason });
}
const CONFIG_MISSING = "app-store-config-missing";
const METADATA_INVALID = "app-store-metadata-invalid";

function requireValue(value, label, reason = CONFIG_MISSING) {
  if (typeof value !== "string" || !value.trim())
    throw refuse(`${label} is required`, reason);
  return value.trim();
}

const invalidMetadata = (message) => refuse(message, METADATA_INVALID);

export function releaseTypeOf() {
  return "AFTER_APPROVAL";
}

export function validateMetadata(metadata, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw invalidMetadata(
      "Public releases require a three-part numeric version",
    );
  if (metadata.version !== version)
    throw invalidMetadata("Release metadata version does not match the build");
  if (metadata.draft !== undefined)
    throw invalidMetadata("Release metadata is still marked as a draft");
  if (
    metadata.releaseType !== undefined &&
    metadata.releaseType !== "AFTER_APPROVAL"
  )
    throw invalidMetadata("releaseType must be AFTER_APPROVAL");
  requireValue(metadata.copyright, "copyright", METADATA_INVALID);
  const reviewNotes = requireValue(
    metadata.reviewNotes,
    "reviewNotes",
    METADATA_INVALID,
  );
  if (reviewNotes.length > 4000)
    throw invalidMetadata("Review notes exceed 4000 characters");
  if (
    !metadata.whatsNew ||
    typeof metadata.whatsNew !== "object" ||
    Array.isArray(metadata.whatsNew)
  ) {
    throw invalidMetadata(
      "whatsNew must map each store locale to release notes",
    );
  }
  const locales = Object.keys(metadata.whatsNew);
  if (!locales.length)
    throw invalidMetadata("At least one store locale is required");
  for (const locale of locales) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(locale))
      throw invalidMetadata("Invalid store locale");
    if (
      requireValue(
        metadata.whatsNew[locale],
        `whatsNew.${locale}`,
        METADATA_INVALID,
      ).length > 4000
    ) {
      throw invalidMetadata("Release notes exceed 4000 characters");
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
  let signature;
  try {
    signature = sign("sha256", Buffer.from(unsigned), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
  } catch (error) {
    throw refuse(
      "App Store Connect API key could not sign a token",
      "app-store-auth-key-invalid",
      { cause: error },
    );
  }
  return `${unsigned}.${signature.toString("base64url")}`;
}

// Undici reports connection failures as TypeError("fetch failed") whose cause
// carries a code; a hung read ends in the timeout signal's TimeoutError.
const timeoutNames = new Set(["TimeoutError", "AbortError"]);
const networkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
function transportFailure(error) {
  const chain = [error, error?.cause].filter(Boolean);
  if (
    chain.some(
      (item) =>
        timeoutNames.has(item.name) ||
        item.code === "UND_ERR_CONNECT_TIMEOUT" ||
        item.code === "UND_ERR_HEADERS_TIMEOUT" ||
        item.code === "UND_ERR_BODY_TIMEOUT",
    )
  )
    return {
      message: "App Store Connect read timed out",
      reason: "app-store-read-timeout",
    };
  if (
    error?.name === "TypeError" ||
    chain.some(
      (item) =>
        (typeof item.code === "string" && item.code.startsWith("UND_ERR_")) ||
        networkCodes.has(item.code),
    )
  )
    return {
      message: "App Store Connect read failed on the network",
      reason: "app-store-read-network",
    };
  return null;
}

// Apple's error code and the attribute its source pointer names are a fixed
// vocabulary; they are kept only when they match these patterns. The title,
// detail, ids and any other text in the response never leave the process.
const APPLE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,39}(?:\.[A-Z0-9_]{1,40}){0,6}$/;
const APPLE_ATTRIBUTE_POINTER =
  /^\/data\/attributes\/([a-z][A-Za-z0-9]{0,39})$/;
// App Store Connect resource types an error can name. Anything else is
// reported as "other", so a receipt only ever carries one of these words.
export const APPLE_RESOURCE_KINDS = new Set([
  "ageRatingDeclarations",
  "appAvailabilities",
  "appCategories",
  "appClipDefaultExperiences",
  "appDataUsages",
  "appEncryptionDeclarations",
  "appInfoLocalizations",
  "appInfos",
  "appPreviewSets",
  "appPreviews",
  "appPriceSchedules",
  "apps",
  "appScreenshotSets",
  "appScreenshots",
  "appStoreReviewAttachments",
  "appStoreReviewDetails",
  "appStoreVersionLocalizations",
  "appStoreVersionPhasedReleases",
  "appStoreVersions",
  "appStoreVersionSubmissions",
  "builds",
  "endUserLicenseAgreements",
  "inAppPurchases",
  "reviewSubmissionItems",
  "reviewSubmissions",
  "routingAppCoverages",
  "subscriptionGroups",
  "subscriptions",
  "territoryAvailabilities",
]);
// "/v1/<kind>/<id>[/...]". The id is held only in memory, to look up which
// locale a resource belongs to; it is never retained.
const APPLE_RESOURCE_PATH =
  /^\/v1\/([A-Za-z]{1,60})(?:\/([A-Za-z0-9-]{1,64}))?(?:\/[A-Za-z0-9/-]{0,200})?$/;
export function resourceKindOf(path) {
  const kind =
    typeof path === "string" && path.length <= 300
      ? APPLE_RESOURCE_PATH.exec(path)?.[1]
      : undefined;
  if (!kind) return null;
  return APPLE_RESOURCE_KINDS.has(kind) ? kind : "other";
}
const codeOf = (error) =>
  typeof error?.code === "string" &&
  error.code.length <= 100 &&
  APPLE_ERROR_CODE.test(error.code)
    ? error.code
    : null;
const attributeOf = (error) => {
  const pointer = error?.source?.pointer;
  return typeof pointer === "string" && pointer.length <= 100
    ? (APPLE_ATTRIBUTE_POINTER.exec(pointer)?.[1] ?? null)
    : null;
};
// Apple explains a refused state change (for example 409
// STATE_ERROR.ENTITY_STATE_INVALID when a version is not complete enough to
// submit) in meta.associatedErrors: resource path -> errors. Only each
// error's code and attribute, and the path's resource kind, are kept.
export const ASSOCIATED_ERRORS_SCANNED = 100;
function associatedErrorsOf(errors) {
  const result = [];
  for (const error of errors) {
    const associated = error?.meta?.associatedErrors;
    if (!associated || typeof associated !== "object") continue;
    for (const [path, list] of Object.entries(associated)) {
      if (!Array.isArray(list)) continue;
      const match =
        path.length <= 300 ? APPLE_RESOURCE_PATH.exec(path) : undefined;
      for (const item of list) {
        if (result.length >= ASSOCIATED_ERRORS_SCANNED) return result;
        result.push({
          code: codeOf(item),
          attribute: attributeOf(item),
          resource: resourceKindOf(path),
          resourceId: match?.[2] ?? null,
        });
      }
    }
  }
  return result;
}
export function appleErrorOf(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const [first] = errors;
  return {
    code: codeOf(first),
    attribute: attributeOf(first),
    associated: associatedErrorsOf(errors),
  };
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
      throw refuse(
        "Unexpected App Store Connect URL",
        "app-store-pagination-url-unexpected",
      );
    }
    for (let attempt = 0; ; attempt++) {
      // Writes are not blindly retried: rerun the job to reconcile actual server state.
      const retriable = method === "GET" && attempt < 4;
      const authorization = `Bearer ${createToken(credentials)}`;
      let response;
      let body;
      try {
        response = await fetchImpl(url, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: data === undefined ? undefined : JSON.stringify({ data }),
        });
        if (retriable && (response.status === 429 || response.status >= 500)) {
          await sleepImpl(1000 * 2 ** attempt);
          continue;
        }
        if (response.ok && response.status !== 204)
          body = await response.json();
      } catch (error) {
        if (response?.ok && error?.name === "SyntaxError")
          throw refuse(
            "App Store Connect response was not valid JSON",
            "app-store-read-unparseable",
            { cause: error },
          );
        const failure = transportFailure(error);
        if (!failure) throw error;
        if (retriable) {
          await sleepImpl(1000 * 2 ** attempt);
          continue;
        }
        if (method !== "GET") throw error;
        throw refuse(failure.message, failure.reason, { cause: error });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const codes =
          body.errors?.map((error) => error.code).join(", ") || "unknown";
        throw Object.assign(
          new Error(
            `App Store Connect ${method} ${url.pathname}: HTTP ${response.status} (${codes}). Check the listing in App Store Connect; no automatic cancellation or replacement was attempted.`,
          ),
          {
            status: response.status,
            method,
            resource: resourceKindOf(url.pathname),
            apple: appleErrorOf(body),
          },
        );
      }
      return response.status === 204 ? {} : body;
    }
  }
  async function list(path) {
    const result = [];
    const seen = new Set();
    while (path) {
      if (seen.has(path))
        throw refuse(
          "Repeated pagination URL",
          "app-store-pagination-repeated",
        );
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

// Every existing store locale needs release notes. A locale with notes but no
// store localization yet is created only when the repository listing has text
// for it; otherwise it must be configured in App Store Connect first.
function assertLocales(localizations, metadata, listing = {}) {
  const actual = new Set(localizations.map((item) => item.attributes.locale));
  const notes = Object.keys(metadata.whatsNew);
  if (
    [...actual].some((locale) => !notes.includes(locale)) ||
    notes.some((locale) => !actual.has(locale) && !listing[locale])
  ) {
    throw new Error(
      "Release notes must cover exactly all existing store locales; configure new locales in App Store Connect first",
    );
  }
}

// Store text is compared as people read it: line endings, Unicode form and
// surrounding whitespace are not differences.
const normalized = (value) =>
  typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").normalize("NFC").trim()
    : value;
export const sameText = (a, b) => normalized(a) === normalized(b);

// Saved state must match the request exactly: one localization per noted
// locale, with its notes and, where the repository lists it, its listing text.
function listingMismatch(localizations, metadata, listing) {
  const actual = localizations.map((item) => item.attributes.locale).sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(Object.keys(metadata.whatsNew).sort())
  )
    return true;
  return localizations.some((item) => {
    const { locale } = item.attributes;
    const expected = listing[locale];
    return (
      !sameText(item.attributes.whatsNew, metadata.whatsNew[locale]) ||
      (expected &&
        versionFields.some(
          (field) => !sameText(item.attributes[field], expected[field]),
        ))
    );
  });
}

const versionFields = ["description", "keywords", "promotionalText"];
const appInfoFields = ["name", "subtitle"];
const editableAppInfoStates = new Set([
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "DEVELOPER_REJECTED",
  "REJECTED",
]);
const pick = (object, fields) =>
  Object.fromEntries(fields.map((field) => [field, object[field]]));

// The app's name and subtitle live on the editable app info that Apple opens
// alongside a new version. The listed (read-only) app info is never touched.
async function editableAppInfo(client) {
  const infos = await client.list(`apps/${APP_ID}/appInfos`);
  const editable = infos.filter((info) =>
    editableAppInfoStates.has(
      info.attributes.state ?? info.attributes.appStoreState,
    ),
  );
  if (editable.length !== 1)
    throw new Error(
      "App Store Connect has no single editable app info for the new version; inspect App Store Connect",
    );
  return editable[0];
}

async function applyAppInfoListing(client, listing) {
  const info = await editableAppInfo(client);
  const existing = await client.list(
    `appInfos/${info.id}/appInfoLocalizations`,
  );
  rememberAll(client, existing);
  const template = existing.find((item) => item.attributes.privacyPolicyUrl);
  for (const [locale, entry] of Object.entries(listing)) {
    const current = existing.find((item) => item.attributes.locale === locale);
    const attributes = pick(entry, appInfoFields);
    if (current) {
      const needsPrivacyUrl = template && !current.attributes.privacyPolicyUrl;
      if (
        !needsPrivacyUrl &&
        appInfoFields.every((field) =>
          sameText(current.attributes[field], attributes[field]),
        )
      )
        continue;
      writing(client, locale);
      await client.request(`appInfoLocalizations/${current.id}`, "PATCH", {
        type: "appInfoLocalizations",
        id: current.id,
        attributes: {
          ...attributes,
          ...(needsPrivacyUrl
            ? { privacyPolicyUrl: template.attributes.privacyPolicyUrl }
            : {}),
        },
      });
    } else {
      writing(client, locale);
      await client.request("appInfoLocalizations", "POST", {
        type: "appInfoLocalizations",
        attributes: {
          locale,
          ...attributes,
          ...(template
            ? { privacyPolicyUrl: template.attributes.privacyPolicyUrl }
            : {}),
        },
        relationships: { appInfo: relation("appInfos", info.id) },
      });
    }
  }
}

async function appInfoListingMismatch(client, listing) {
  if (!Object.keys(listing).length) return false;
  const info = await editableAppInfo(client);
  const saved = rememberAll(
    client,
    await client.list(`appInfos/${info.id}/appInfoLocalizations`),
  );
  return Object.entries(listing).some(([locale, entry]) => {
    const item = saved.find(
      (candidate) => candidate.attributes.locale === locale,
    );
    return (
      !item ||
      appInfoFields.some(
        (field) => !sameText(item.attributes[field], entry[field]),
      )
    );
  });
}

// Properties App Store Connect requires on every localization before a
// version can be submitted ("required and can be localized" in Apple's
// platform version and app information references). Checked on the primary
// locale and every listed locale, so a gap stops at read-back with the locale
// and property named, instead of as an opaque refusal of the submission.
// whatsNew is required on every localization of an update, including a
// language the update adds: the 1.0.31 review submission item was refused
// with ENTITY_ERROR.ATTRIBUTE.REQUIRED on whatsNew for es-ES, es-MX, fr-CA
// and fr-FR.
const requiredVersionFields = [
  "description",
  "keywords",
  "supportUrl",
  "whatsNew",
];
const requiredAppInfoFields = ["name", "privacyPolicyUrl"];
export class ListingIncomplete extends Error {
  constructor(locale, attribute) {
    super("A listed locale is missing a property App Store Connect requires");
    this.postWrite = "listing-required-missing";
    this.locale = locale;
    this.missing = attribute;
  }
}
async function assertListingComplete(client, app, localizations, listing) {
  const locales = [
    app.attributes.primaryLocale,
    ...Object.keys(listing).filter(
      (locale) => locale !== app.attributes.primaryLocale,
    ),
  ];
  const info = await editableAppInfo(client);
  const infoLocales = rememberAll(
    client,
    await client.list(`appInfos/${info.id}/appInfoLocalizations`),
  );
  const blank = (value) => typeof value !== "string" || !value.trim();
  for (const locale of locales) {
    const version = localizations.find(
      (item) => item.attributes.locale === locale,
    );
    const appInfo = infoLocales.find(
      (item) => item.attributes.locale === locale,
    );
    const gap =
      (!version && "locale") ||
      requiredVersionFields.find((field) => blank(version.attributes[field])) ||
      (!appInfo && "locale") ||
      requiredAppInfoFields.find((field) => blank(appInfo.attributes[field]));
    if (gap) {
      writing(client, locale);
      throw new ListingIncomplete(locale, gap);
    }
  }
}

// What a commit would change in the version listing, for dry runs.
function listingPlan(localizations, metadata, listing, released) {
  const existing = new Map(
    localizations.map((item) => [item.attributes.locale, item]),
  );
  return {
    createLocales: Object.keys(metadata.whatsNew).filter(
      (locale) => !existing.has(locale),
    ),
    updateLocales: Object.entries(listing)
      .filter(([locale, entry]) => {
        const item = existing.get(locale);
        return (
          item &&
          versionFields.some(
            (field) => !sameText(item.attributes[field], entry[field]),
          )
        );
      })
      .map(([locale]) => locale),
    // Languages the live version lacks. They are created without release
    // notes, which are then set by PATCH (see submitAppStore).
    firstReleaseLocales: Object.keys(metadata.whatsNew).filter(
      (locale) => !released.has(locale),
    ),
    whatsNew: metadata.whatsNew,
  };
}

// Screenshots go on the primary locale and on every locale the repository
// lists. App Store Connect's web form starts a newly added language with the
// primary language's screenshots, but a localization created through the API
// has no screenshot sets at all, and Apple then refuses the review submission
// item (409 STATE_ERROR.ENTITY_STATE_INVALID; inferred from the 1.0.31
// refusal, when six API-created locales had none). The repository has one set per
// device, so every listed locale gets that set; App Store users see the same
// images they would see if the language fell back to the primary one.
// Locales that only exist in App Store Connect keep their own screenshots.
// A managed set is replaced only when its ordered checksums differ; smaller
// iPhone and iPad sets are emptied so Apple scales the managed ones instead
// of showing stale images.
// Apple publishes sourceFileChecksum shortly after a screenshot reaches
// COMPLETE, so a screenshot is delivered only once both are present.
const delivered = (shot) =>
  shot.attributes.assetDeliveryState?.state === "COMPLETE" &&
  Boolean(shot.attributes.sourceFileChecksum);
const sameFile = (shot, file) =>
  shot.attributes.sourceFileChecksum === file.md5 && delivered(shot);
// While Apple is still processing, the checksum may be missing; the name and
// size then identify the upload, so a rerun after a timed-out wait keeps
// waiting instead of uploading the same images again.
const inFlight = (shot, file) =>
  ["UPLOAD_COMPLETE", "COMPLETE"].includes(
    shot.attributes.assetDeliveryState?.state,
  ) &&
  (shot.attributes.sourceFileChecksum
    ? shot.attributes.sourceFileChecksum === file.md5
    : shot.attributes.fileName === file.fileName &&
      shot.attributes.fileSize === file.bytes.length);
const isDeviceSet = (type) => /^APP_(IPHONE|IPAD)_/.test(type);

async function screenshotSets(client, localization) {
  const sets = await client.list(
    `appStoreVersionLocalizations/${localization.id}/appScreenshotSets`,
  );
  for (const set of sets)
    remember(client, set.id, localization.attributes.locale);
  return sets;
}

const screenshotsOf = (client, setId) =>
  client.list(`appScreenshotSets/${setId}/appScreenshots`);

function sameScreenshots(shots, files, matches = sameFile) {
  return (
    shots.length === files.length &&
    shots.every((shot, index) => matches(shot, files[index]))
  );
}

async function uploadScreenshot(client, setId, file, upload) {
  const shot = (
    await client.request("appScreenshots", "POST", {
      type: "appScreenshots",
      attributes: { fileName: file.fileName, fileSize: file.bytes.length },
      relationships: {
        appScreenshotSet: relation("appScreenshotSets", setId),
      },
    })
  ).data;
  for (const operation of shot.attributes.uploadOperations ?? []) {
    // Apple's presigned asset URLs never receive the API bearer token.
    const url = new URL(operation.url);
    if (url.protocol !== "https:")
      throw Object.assign(new Error("Unexpected screenshot upload URL"), {
        postWrite: "screenshot-upload-url-unexpected",
      });
    const response = await upload(url, {
      method: operation.method,
      headers: Object.fromEntries(
        (operation.requestHeaders ?? []).map(({ name, value }) => [
          name,
          value,
        ]),
      ),
      body: file.bytes.subarray(
        operation.offset,
        operation.offset + operation.length,
      ),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(`Screenshot upload failed: HTTP ${response.status}`),
        { status: response.status, postWrite: "screenshot-upload-rejected" },
      );
  }
  await client.request(`appScreenshots/${shot.id}`, "PATCH", {
    type: "appScreenshots",
    id: shot.id,
    attributes: { uploaded: true, sourceFileChecksum: file.md5 },
  });
  return shot.id;
}

async function syncLocaleScreenshots(client, localization, media, upload) {
  writing(client, localization.attributes.locale);
  const sets = await screenshotSets(client, localization);
  for (const [type, files] of Object.entries(media)) {
    let set = sets.find(
      (item) => item.attributes.screenshotDisplayType === type,
    );
    if (!set) {
      set = (
        await client.request("appScreenshotSets", "POST", {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: type },
          relationships: {
            appStoreVersionLocalization: relation(
              "appStoreVersionLocalizations",
              localization.id,
            ),
          },
        })
      ).data;
      remember(client, set.id, localization.attributes.locale);
    }
    const shots = await screenshotsOf(client, set.id);
    if (sameScreenshots(shots, files, inFlight)) continue;
    for (const shot of shots)
      await client.request(`appScreenshots/${shot.id}`, "DELETE");
    const ids = [];
    for (const file of files)
      ids.push(await uploadScreenshot(client, set.id, file, upload));
    await client.request(
      `appScreenshotSets/${set.id}/relationships/appScreenshots`,
      "PATCH",
      ids.map((id) => ({ type: "appScreenshots", id })),
    );
  }
  for (const set of sets) {
    const type = set.attributes.screenshotDisplayType;
    if (media[type] || !isDeviceSet(type)) continue;
    for (const shot of await screenshotsOf(client, set.id))
      await client.request(`appScreenshots/${shot.id}`, "DELETE");
  }
}

async function syncScreenshots(
  client,
  localizations,
  media,
  // One wait covers every locale's uploads (about 15 minutes).
  { upload = fetch, sleepImpl = sleep, attempts = 60 } = {},
) {
  for (const localization of localizations)
    await syncLocaleScreenshots(client, localization, media, upload);
  client.locale = null;
  // Apple processes uploads asynchronously; submission needs them delivered.
  for (let attempt = 0; ; attempt++) {
    let pending = false;
    for (const localization of localizations) {
      const current = await screenshotSets(client, localization);
      for (const type of Object.keys(media)) {
        const set = current.find(
          (item) => item.attributes.screenshotDisplayType === type,
        );
        for (const shot of set ? await screenshotsOf(client, set.id) : []) {
          if (shot.attributes.assetDeliveryState?.state === "FAILED")
            throw new Error(
              "Apple could not process a store screenshot; inspect App Store Connect",
            );
          if (!delivered(shot)) pending = true;
        }
      }
    }
    if (!pending) return;
    if (attempt + 1 >= attempts)
      throw new Error(
        "Timed out waiting for Apple to process store screenshots; rerun the submission",
      );
    await sleepImpl(15_000);
  }
}

async function screenshotsMismatch(client, localizations, media) {
  for (const localization of localizations) {
    const sets = await screenshotSets(client, localization);
    for (const set of sets) {
      const type = set.attributes.screenshotDisplayType;
      const shots = await screenshotsOf(client, set.id);
      if (
        media[type]
          ? !sameScreenshots(shots, media[type])
          : isDeviceSet(type) && shots.length
      )
        return true;
    }
    if (
      Object.keys(media).some(
        (type) =>
          !sets.some((set) => set.attributes.screenshotDisplayType === type),
      )
    )
      return true;
  }
  return false;
}

function primaryLocalization(app, localizations) {
  const primary = localizations.find(
    (item) => item.attributes.locale === app.attributes.primaryLocale,
  );
  if (!primary)
    throw new Error(
      "The primary locale has no version localization; inspect App Store Connect",
    );
  return primary;
}

// The localizations that carry the repository's screenshots: the primary
// locale first, then every listed locale on the version, in listing order.
function screenshotLocalizations(app, localizations, listing) {
  const primary = primaryLocalization(app, localizations);
  return [
    primary,
    ...Object.keys(listing)
      .filter((locale) => locale !== primary.attributes.locale)
      .map((locale) =>
        localizations.find((item) => item.attributes.locale === locale),
      )
      .filter(Boolean),
  ];
}

function demoCredentialsOf(env) {
  const name = env.APP_REVIEW_DEMO_ACCOUNT_NAME;
  const password = env.APP_REVIEW_DEMO_ACCOUNT_PASSWORD;
  // Unset GitHub secrets arrive as empty strings. Never normalize the password.
  if (!name && !password) return undefined;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof password !== "string" ||
    !password.length
  ) {
    throw new Error(
      "App review credentials require both a nonempty account name and password",
    );
  }
  return {
    demoAccountName: name,
    demoAccountPassword: password,
    demoAccountRequired: true,
  };
}

async function readReview(client, versionId) {
  const query = new URLSearchParams({
    "fields[appStoreReviewDetails]":
      "contactEmail,contactFirstName,contactLastName,contactPhone,notes,demoAccountName,demoAccountRequired",
  });
  return (
    await client.request(
      `appStoreVersions/${versionId}/appStoreReviewDetail?${query}`,
    )
  ).data;
}

function verifyDemoAccount(review, credentials) {
  if (!credentials) return {};
  if (
    review?.attributes?.demoAccountName !== credentials.demoAccountName ||
    review?.attributes?.demoAccountRequired !== true
  ) {
    throw new Error(
      "Saved app review credentials do not match the configured account name and required flag; inspect App Store Connect before rerunning",
    );
  }
  // Deliberately return only safe verification flags, never either credential.
  return { demoAccountNameVerified: true, demoAccountRequired: true };
}

// Rolling release notes describe the first release after they change. Once
// the live version already carries them, later releases say only
// "TaskNotes x.y.z." until the notes are rewritten.
function withoutRepeatedNotes(liveLocales, metadata, listing, version) {
  const rolling = Object.entries(listing).filter(
    ([locale, entry]) =>
      entry.whatsNew && sameText(metadata.whatsNew[locale], entry.whatsNew),
  );
  if (!rolling.length) return metadata;
  const whatsNew = { ...metadata.whatsNew };
  for (const [locale, entry] of rolling) {
    const shipped = liveLocales.find(
      (item) => item.attributes.locale === locale,
    );
    if (shipped && sameText(shipped.attributes.whatsNew, entry.whatsNew))
      whatsNew[locale] = `TaskNotes ${version}.`;
  }
  return { ...metadata, whatsNew };
}

// Fixed phases of the commit path. A failure after a write attempt is
// retained only as the phase it happened in, never as a message.
export const SUBMISSION_PHASES = new Set([
  "version",
  "version-localizations",
  "app-info-localizations",
  "screenshots",
  "review-details",
  "read-back",
  "review-submission",
  "confirmation",
]);
function enter(client, phase) {
  client.phase = phase;
  client.locale = null;
}
// The locale code a localization write is for, kept for the post-write
// receipt alongside the phase.
function writing(client, locale) {
  client.locale = locale;
}
// Which locale a localization or screenshot set id belongs to, so Apple's
// associated errors can be reported by locale without keeping any id.
function remember(client, id, locale) {
  if (typeof id !== "string" || typeof locale !== "string") return;
  if (!(client.resourceLocales instanceof Map))
    client.resourceLocales = new Map();
  client.resourceLocales.set(id, locale);
}
const rememberAll = (client, localizations) => {
  for (const item of localizations)
    remember(client, item.id, item.attributes?.locale);
  return localizations;
};

const compareVersions = (a, b) => {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};

// A version this workflow created but never submitted (for example after a
// failed run) stays in PREPARE_FOR_SUBMISSION. Apple allows only one editable
// version, so a newer release adopts it instead of waiting on it forever.
function adoptableDraft(versions, version) {
  const open = versions.filter((item) => !releasedStates.has(state(item)));
  if (open.length !== 1) return undefined;
  const [draft] = open;
  return state(draft) === "PREPARE_FOR_SUBMISSION" &&
    /^\d+\.\d+\.\d+$/.test(draft.attributes.versionString ?? "") &&
    compareVersions(draft.attributes.versionString, version) < 0
    ? draft
    : undefined;
}

export async function submitAppStore({
  client,
  version,
  buildNumber,
  metadata,
  listing = {},
  commit = false,
  waitOptions,
  media = {},
  mediaOptions,
  env = process.env,
}) {
  validateMetadata(metadata, version);
  const demoCredentials = demoCredentialsOf(env);
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
  const adopted = target ? undefined : adoptableDraft(versions, version);
  target ??= adopted;
  const current = versions.find((item) => state(item) === "READY_FOR_SALE");
  if (!current)
    throw new Error(
      "This workflow updates an existing public app; the initial listing requires manual setup",
    );
  if (target) {
    const linked = (
      await client.request(`appStoreVersions/${target.id}/relationships/build`)
    ).data;
    // An unsubmitted draft may be re-pointed at the exact qualified build;
    // anything Apple has already received keeps its build.
    if (
      linked &&
      linked.id !== build.id &&
      state(target) !== "PREPARE_FOR_SUBMISSION"
    )
      throw new Error(
        "Store version is attached to a different build; refusing to replace it",
      );
    if (
      submittedStates.has(state(target)) ||
      releasedStates.has(state(target))
    ) {
      // Reconcile read-only: a previously submitted version must never be patched.
      target = (await client.request(`appStoreVersions/${target.id}`)).data;
      if (
        !linked ||
        (!releasedStates.has(state(target)) &&
          target.attributes.releaseType !== releaseTypeOf(metadata))
      ) {
        throw new Error(
          "Existing submitted version does not match the expected release policy",
        );
      }
      const demoVerification = demoCredentials
        ? verifyDemoAccount(
            await readReview(client, target.id),
            demoCredentials,
          )
        : {};
      return {
        version,
        buildNumber,
        versionId: target.id,
        state: state(target),
        releaseType: target.attributes.releaseType,
        ...demoVerification,
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
    throw new Error("earlier-store-version-in-flight");
  }
  const liveLocales = await client.list(
    `appStoreVersions/${current.id}/appStoreVersionLocalizations`,
  );
  // Every localization of an update needs release notes before Apple accepts
  // the review submission item, including languages this update adds. Those
  // are created without whatsNew and get it by PATCH right after creation:
  // a 409 STATE_ERROR on whatsNew in the create POST was inferred, never
  // proven, and a refusal of the PATCH names its method, attribute and
  // locale in the post-write receipt.
  const released = new Set(liveLocales.map((item) => item.attributes.locale));
  metadata = withoutRepeatedNotes(liveLocales, metadata, listing, version);
  const sourceId = target?.id ?? current.id;
  const localizations = await client.list(
    `appStoreVersions/${sourceId}/appStoreVersionLocalizations`,
  );
  assertLocales(localizations, metadata, listing);
  const review = await readReview(client, sourceId);
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
    throw new Error("earlier-store-version-in-flight");
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
      ...(adopted ? { wouldAdoptDraft: true } : {}),
      listingPlan: listingPlan(localizations, metadata, listing, released),
    };

  enter(client, "version");
  if (!target) {
    target = (
      await client.request("appStoreVersions", "POST", {
        type: "appStoreVersions",
        attributes: {
          platform: "IOS",
          versionString: version,
          copyright: metadata.copyright,
          releaseType: releaseTypeOf(metadata),
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
        ...(adopted ? { versionString: version } : {}),
        copyright: metadata.copyright,
        releaseType: releaseTypeOf(metadata),
        earliestReleaseDate: null,
      },
      relationships: { build: relation("builds", build.id) },
    });
    // Apple inherits listing text, screenshots and review contacts when creating an update.
    // Verify inheritance rather than fabricating contact credentials or legal declarations.
    const inherited = await client.list(
      `appStoreVersions/${target.id}/appStoreVersionLocalizations`,
    );
    assertLocales(inherited, metadata, listing);
    enter(client, "version-localizations");
    for (const locale of inherited) {
      const entry = listing[locale.attributes.locale];
      const attributes = {
        ...(entry ? pick(entry, versionFields) : {}),
        whatsNew: metadata.whatsNew[locale.attributes.locale],
      };
      // A rerun leaves text that already matches alone.
      if (
        Object.entries(attributes).every(([field, value]) =>
          sameText(locale.attributes[field], value),
        )
      )
        continue;
      writing(client, locale.attributes.locale);
      await client.request(
        `appStoreVersionLocalizations/${locale.id}`,
        "PATCH",
        {
          type: "appStoreVersionLocalizations",
          id: locale.id,
          attributes,
        },
      );
    }
    // New listing locales reuse the existing support and marketing URLs.
    const urls = inherited.find((item) => item.attributes.supportUrl);
    for (const locale of Object.keys(metadata.whatsNew)) {
      if (inherited.some((item) => item.attributes.locale === locale)) continue;
      writing(client, locale);
      const created = await client.request(
        "appStoreVersionLocalizations",
        "POST",
        {
          type: "appStoreVersionLocalizations",
          attributes: {
            locale,
            ...pick(listing[locale], versionFields),
            ...(urls
              ? {
                  supportUrl: urls.attributes.supportUrl,
                  ...(urls.attributes.marketingUrl
                    ? { marketingUrl: urls.attributes.marketingUrl }
                    : {}),
                }
              : {}),
          },
          relationships: {
            appStoreVersion: relation("appStoreVersions", target.id),
          },
        },
      );
      // Release notes go on the new localization as its own write, so a
      // refusal is told apart from the create in the receipt (method PATCH,
      // attribute whatsNew, this locale).
      await client.request(
        `appStoreVersionLocalizations/${created.data.id}`,
        "PATCH",
        {
          type: "appStoreVersionLocalizations",
          id: created.data.id,
          attributes: { whatsNew: metadata.whatsNew[locale] },
        },
      );
    }
    enter(client, "app-info-localizations");
    if (Object.keys(listing).length) await applyAppInfoListing(client, listing);
    enter(client, "screenshots");
    if (Object.keys(media).length)
      await syncScreenshots(
        client,
        screenshotLocalizations(
          app,
          rememberAll(
            client,
            await client.list(
              `appStoreVersions/${target.id}/appStoreVersionLocalizations`,
            ),
          ),
          listing,
        ),
        media,
        mediaOptions,
      );
    enter(client, "review-details");
    const detail = await readReview(client, target.id);
    if (!detail)
      throw new Error(
        "Apple did not inherit review details; configure them before rerunning",
      );
    await client.request(`appStoreReviewDetails/${detail.id}`, "PATCH", {
      type: "appStoreReviewDetails",
      id: detail.id,
      attributes: { notes: metadata.reviewNotes, ...demoCredentials },
    });
  }
  // Read back durable state before the irreversible submission step (also on reruns).
  enter(client, "read-back");
  const prepared = (await client.request(`appStoreVersions/${target.id}`)).data;
  const attached = (
    await client.request(`appStoreVersions/${target.id}/relationships/build`)
  ).data;
  const savedLocales = rememberAll(
    client,
    await client.list(
      `appStoreVersions/${target.id}/appStoreVersionLocalizations`,
    ),
  );
  const savedReview = await readReview(client, target.id);
  const demoVerification = verifyDemoAccount(savedReview, demoCredentials);
  // A blank required property is named before the general comparison, which
  // would otherwise report it only as a mismatch.
  await assertListingComplete(client, app, savedLocales, listing);
  if (
    attached?.id !== build.id ||
    prepared.attributes.versionString !== version ||
    prepared.attributes.releaseType !== releaseTypeOf(metadata) ||
    prepared.attributes.earliestReleaseDate ||
    listingMismatch(savedLocales, metadata, listing) ||
    (await appInfoListingMismatch(client, listing)) ||
    (Object.keys(media).length &&
      (await screenshotsMismatch(
        client,
        screenshotLocalizations(app, savedLocales, listing),
        media,
      ))) ||
    savedReview?.attributes?.notes !== metadata.reviewNotes
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
  enter(client, "review-submission");
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
  enter(client, "confirmation");
  const confirmed = (await client.request(`appStoreVersions/${target.id}`))
    .data;
  if (confirmed.attributes.releaseType !== releaseTypeOf(metadata)) {
    throw new Error(
      "Release policy changed during submission; inspect App Store Connect immediately",
    );
  }
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
    releaseType: confirmed.attributes.releaseType,
    ...demoVerification,
    alreadySubmitted: false,
  };
}

// The reviewed release notes every other locale falls back to: the App
// Store primary locale, which every release metadata file carries.
const NOTES_FALLBACK_LOCALE = "en-AU";
const fallbackNotes = (whatsNew, version) =>
  whatsNew[NOTES_FALLBACK_LOCALE] ?? `TaskNotes ${version}.`;

// Locales the repository listing adds get its rolling release notes, or the
// reviewed en-AU notes when it has none (Apple requires notes on every
// localization of an update). Explicit per-locale notes win.
export function withListingNotes(whatsNew, version, listing) {
  const notes = { ...whatsNew };
  for (const [locale, entry] of Object.entries(listing)) {
    // Locales from the same listing file share one language: reuse its
    // explicit notes so English storefronts never disagree about a build.
    const sibling = Object.keys(whatsNew).find(
      (other) => listing[other] === entry,
    );
    notes[locale] ??= sibling
      ? whatsNew[sibling]
      : (entry.whatsNew ?? fallbackNotes(whatsNew, version));
  }
  return notes;
}

export function generatedMetadata(template, version, listing = {}) {
  // Reuse reviewed instructions/contact custody; never invent privacy,
  // export-compliance, account credentials or feature promises.
  const instructions =
    /HOW TO REVIEW\n([\s\S]*?)(?:\nWHAT CHANGED|\nWHAT THE APP DOES|$)/
      .exec(template.reviewNotes)?.[1]
      ?.trim();
  if (!instructions)
    throw invalidMetadata("No reviewed store instructions template");
  const primaryNotes =
    listing[NOTES_FALLBACK_LOCALE]?.whatsNew ?? `TaskNotes ${version}.`;
  return validateMetadata(
    {
      version,
      copyright: template.copyright,
      releaseType: "AFTER_APPROVAL",
      whatsNew: Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(template.whatsNew),
            ...Object.keys(listing),
          ]),
        ].map((locale) => [
          locale,
          listing[locale]?.whatsNew ??
            (locale in template.whatsNew
              ? `TaskNotes ${version}.`
              : primaryNotes),
        ]),
      ),
      reviewNotes: `TaskNotes ${version}\n\nHOW TO REVIEW\n${instructions}`,
    },
    version,
  );
}

async function readMetadataFile(path) {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw refuse("Release metadata is not valid JSON", METADATA_INVALID, {
      cause: error,
    });
  }
}

async function releaseMetadata(version, listing) {
  try {
    const metadata = validateMetadata(
      await readMetadataFile(`docs/releases/ios/${version}.json`),
      version,
    );
    return validateMetadata(
      {
        ...metadata,
        whatsNew: withListingNotes(metadata.whatsNew, version, listing),
      },
      version,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const templates = (await readdir("docs/releases/ios"))
      .filter((n) => /^\d+\.\d+\.\d+\.json$/.test(n))
      .sort((a, b) => {
        const aa = a.split(".").map(Number),
          bb = b.split(".").map(Number);
        return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2];
      });
    if (!templates.length)
      throw refuse("No reviewed store metadata template", METADATA_INVALID, {
        cause: error,
      });
    return generatedMetadata(
      await readMetadataFile(`docs/releases/ios/${templates[0]}`),
      version,
      listing,
    );
  }
}

// Fixed refusal reasons for failures that happen before any App Store Connect
// write. Only these bounded slugs leave the job; messages and response bodies
// stay in the process.
const refusalReasons = [
  [
    "Timed out waiting for the exact build",
    "app-store-build-processing-timeout",
  ],
  ["Selected build is invalid", "app-store-build-invalid"],
  ["Build needs App Store eligibility", "app-store-build-not-eligible"],
  ["Multiple builds matched", "app-store-build-ambiguous"],
  ["Expected a positive build number", "app-store-build-number-invalid"],
  ["Unexpected app bundle ID", "app-store-bundle-mismatch"],
  [
    "This workflow updates an existing public app",
    "app-store-no-public-version",
  ],
  [
    "Store version is attached to a different build",
    "app-store-version-build-mismatch",
  ],
  [
    "Existing submitted version does not match",
    "app-store-submitted-version-policy-mismatch",
  ],
  [
    "Saved app review credentials do not match",
    "app-store-review-account-mismatch",
  ],
  [
    "App review credentials require both",
    "app-store-review-account-config-invalid",
  ],
  ["Release notes must cover exactly", "app-store-locales-mismatch"],
  [
    "App Store Connect has no single editable app info",
    "app-store-app-info-not-editable",
  ],
  [
    "App review contact information is incomplete",
    "app-store-review-contact-incomplete",
  ],
  [
    "Draft review submission contains unrelated items",
    "app-store-draft-submission-unrelated",
  ],
  [
    "Saved release metadata/build does not match",
    "app-store-saved-state-mismatch",
  ],
  ["A phased release is configured", "app-store-phased-release-configured"],
];

// Slugs attached where an error is thrown (see refuse()).
const taggedReasons = new Set([
  CONFIG_MISSING,
  METADATA_INVALID,
  "app-store-read-timeout",
  "app-store-read-network",
  "app-store-read-unparseable",
  "app-store-pagination-url-unexpected",
  "app-store-pagination-repeated",
  "app-store-auth-key-invalid",
  "store-listing-invalid",
  "store-media-invalid",
]);
// Unrecognised failures name only a fixed error class, never the message.
const errorClasses = new Map([
  ["TypeError", "typeerror"],
  ["RangeError", "rangeerror"],
  ["SyntaxError", "syntaxerror"],
  ["Error", "error"],
]);

export function refusalReason(error) {
  if (taggedReasons.has(error?.refusal)) return error.refusal;
  const message = typeof error?.message === "string" ? error.message : "";
  const attention =
    /^Store version needs manual attention: ([A-Z][A-Z0-9_]{0,63})$/.exec(
      message,
    );
  if (attention)
    return `app-store-version-needs-attention-${attention[1].toLowerCase().replaceAll("_", "-")}`;
  const read = /^App Store Connect GET \S+: HTTP (\d{3}) /.exec(message);
  if (read) return `app-store-read-http-${read[1]}`;
  return (
    refusalReasons.find(([prefix]) => message.startsWith(prefix))?.[1] ??
    `app-store-precheck-refused-${errorClasses.get(error?.name) ?? "other"}`
  );
}

// Count every request that is not a GET before it leaves the process, so a
// refusal can prove that no App Store Connect write was even attempted.
export function trackWrites(client) {
  const tracked = {
    writeAttempted: false,
    phase: null,
    locale: null,
    resourceLocales: new Map(),
    request(path, method = "GET", data) {
      if (method !== "GET") tracked.writeAttempted = true;
      return client.request(path, method, data);
    },
    list: (path) => client.list(path),
  };
  return tracked;
}

// Retain a bounded receipt only while no write was attempted, matching the
// Play recheck. After any write attempt nothing is retained, so the
// coordinator keeps its write-started stop.
export async function refusalReceipt(error, client, sourceRunId) {
  if (client && client.writeAttempted !== false) return null;
  const { recheckRefusal } = await import("./mobile-release-policy.mjs");
  return recheckRefusal(refusalReason(error), sourceRunId);
}

// Failures after a write began name a fixed class: where the message is one
// of ours, a slug chosen here; where Apple answered, only the direction of
// the request. Apple's response body, paths and ids never leave the process.
const postWriteReasons = [
  [
    "Apple could not process a store screenshot",
    "screenshot-processing-failed",
  ],
  [
    "Timed out waiting for Apple to process store screenshots",
    "screenshot-processing-timeout",
  ],
  ["The primary locale has no version localization", "primary-locale-missing"],
  ["Apple did not inherit review details", "review-details-missing"],
  ["Review submission items changed", "review-submission-items-changed"],
  ["Release policy changed during submission", "release-policy-changed"],
  ["Apple has not yet confirmed submission", "submission-unconfirmed"],
];
const BOUNDED = /^[a-z0-9-]{1,100}$/;

export function postWriteClass(error) {
  if (BOUNDED.test(error?.postWrite ?? "")) return error.postWrite;
  if (Number.isInteger(error?.status) && typeof error?.method === "string")
    return error.method === "GET"
      ? "app-store-read-rejected"
      : "app-store-write-rejected";
  const transport = transportFailure(error);
  if (transport)
    return transport.reason.replace("app-store-read-", "app-store-request-");
  const message = typeof error?.message === "string" ? error.message : "";
  const known = postWriteReasons.find(([prefix]) =>
    message.startsWith(prefix),
  )?.[1];
  if (known) return known;
  const reason = refusalReason(error);
  return reason.startsWith("app-store-precheck-refused-")
    ? `error-${errorClasses.get(error?.name) ?? "other"}`
    : reason;
}

// After a write attempt the target must keep its write-started stop, so this
// receipt is deliberately not a refusal: it has its own outcome and fields,
// which the coordinator's pre-write refusal check never accepts. It records
// only a fixed phase, the HTTP status Apple returned (if any), a fixed error
// class and, where Apple rejected a write, its fixed error code, the rejected
// attribute's name, the request method and the locale code being written, so
// the next attempt knows where the last one stopped and which field to fix.
// Each value is kept only when it matches a strict pattern; Apple's title and
// detail text, bodies, ids and URLs never leave the job.
export const POST_WRITE_FAILURE = "failed-after-write";
const WRITE_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);
const RECEIPT_LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const ATTRIBUTE_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;
const bounded = (value, pattern) =>
  typeof value === "string" && value.length <= 100 && pattern.test(value)
    ? value
    : null;
export function postWriteReceipt(error, client, sourceRunId) {
  if (!client || client.writeAttempted !== true) return null;
  const runId = Number(sourceRunId);
  if (!Number.isSafeInteger(runId) || runId <= 0) return null;
  const status = error?.status;
  return {
    outcome: POST_WRITE_FAILURE,
    write_started: true,
    phase: SUBMISSION_PHASES.has(client.phase) ? client.phase : "unknown",
    http_status:
      Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null,
    error_class: postWriteClass(error),
    apple_error_code: bounded(error?.apple?.code, APPLE_ERROR_CODE),
    apple_error_attribute: bounded(error?.apple?.attribute, ATTRIBUTE_NAME),
    http_method: WRITE_METHODS.has(error?.method) ? error.method : null,
    locale: bounded(client.locale, RECEIPT_LOCALE),
    ...(error instanceof ListingIncomplete
      ? { missing_attribute: bounded(error.missing, ATTRIBUTE_NAME) }
      : {}),
    request_resource: APPLE_RESOURCE_KINDS.has(error?.resource)
      ? error.resource
      : error?.resource === "other"
        ? "other"
        : null,
    ...associatedReceipt(error?.apple?.associated, client.resourceLocales),
    source_run_id: runId,
  };
}

// Apple's associated errors, as distinct {code, attribute, resource, locale}
// entries: the locale comes from the localizations this run read itself
// (never from Apple's text), and the resource is one fixed kind.
export const ASSOCIATED_ERRORS_KEPT = 20;
function associatedReceipt(associated, resourceLocales) {
  if (!Array.isArray(associated) || !associated.length) return {};
  const seen = new Set();
  const kept = [];
  for (const item of associated.slice(0, ASSOCIATED_ERRORS_SCANNED)) {
    const entry = {
      code: bounded(item?.code, APPLE_ERROR_CODE),
      attribute: bounded(item?.attribute, ATTRIBUTE_NAME),
      resource:
        APPLE_RESOURCE_KINDS.has(item?.resource) || item?.resource === "other"
          ? item.resource
          : null,
      locale: bounded(
        resourceLocales instanceof Map
          ? resourceLocales.get(item?.resourceId)
          : undefined,
        RECEIPT_LOCALE,
      ),
    };
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (kept.length < ASSOCIATED_ERRORS_KEPT) kept.push(entry);
  }
  return {
    apple_associated_errors: kept,
    apple_associated_error_count: Math.min(
      associated.length,
      ASSOCIATED_ERRORS_SCANNED,
    ),
  };
}

async function main(tracker) {
  const version = requireValue(
    process.env.TASKNOTES_IOS_VERSION,
    "TASKNOTES_IOS_VERSION",
  );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw invalidMetadata("Invalid public release version");
  const listing = (await loadStoreListing()).apple;
  const media = (await loadStoreMedia()).apple;
  const metadata = {
    ...(await releaseMetadata(version, listing)),
    releaseType: "AFTER_APPROVAL",
  };
  if (process.argv.includes("--validate")) return;
  const client = trackWrites(
    createClient({
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
    }),
  );
  tracker.client = client;
  const result = await submitAppStore({
    client,
    version,
    buildNumber: process.env.TASKNOTES_IOS_BUILD,
    metadata,
    listing,
    media,
    commit: process.argv.includes("--submit"),
  });
  const qualified = JSON.parse(
    await readFile("mobile-release-qualified.json", "utf8"),
  );
  await writeFile(
    "store-target-result.json",
    JSON.stringify({ outcome: "submitted", source: qualified.source }) + "\n",
  );
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const verificationSummary = result.demoAccountNameVerified
      ? "Review account name verified: **true**. Demo account required: **true**.\n\n"
      : "";
    const releaseSummary = result.releaseType
      ? `Release type (read back): **${result.releaseType}**.\n\n`
      : "";
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## App Store submission\n\nVersion **${result.version}**, build **${result.buildNumber}**: **${result.state}**.\n\n${releaseSummary}${verificationSummary}[App Store Connect](https://appstoreconnect.apple.com/apps/${APP_ID}/distribution)\n\nApple review is required. Submission is not proof of public availability.\n`,
    );
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const tracker = {};
  main(tracker).catch(async (error) => {
    if (error.message === "earlier-store-version-in-flight") {
      const qualified = JSON.parse(
        await readFile("mobile-release-qualified.json", "utf8"),
      );
      await writeFile(
        "store-target-result.json",
        JSON.stringify({
          outcome: "pending-review",
          source: qualified.source,
        }) + "\n",
      );
    } else {
      process.exitCode = 1;
      const receipt = await refusalReceipt(
        error,
        tracker.client,
        process.env.SOURCE_RUN_ID,
      );
      if (receipt) {
        console.error(
          `App Store submission refused before any write: ${receipt.reason}`,
        );
        await writeFile(
          "store-target-result.json",
          JSON.stringify(receipt) + "\n",
        ).catch(() => {});
      } else {
        const failure = postWriteReceipt(
          error,
          tracker.client,
          process.env.SOURCE_RUN_ID,
        );
        if (failure) {
          console.error(
            `App Store submission failed after a write began: phase ${failure.phase}, HTTP ${failure.http_method ?? ""} ${failure.http_status ?? "none"}, ${failure.error_class}, Apple code ${failure.apple_error_code ?? "none"}, attribute ${failure.apple_error_attribute ?? "none"}, locale ${failure.locale ?? "none"}${failure.missing_attribute ? `, missing ${failure.missing_attribute}` : ""}, resource ${failure.request_resource ?? "none"}${failure.apple_associated_errors ? `, associated errors (${failure.apple_associated_error_count}): ${failure.apple_associated_errors.map((item) => [item.code, item.attribute, item.resource, item.locale].map((value) => value ?? "-").join(" ")).join("; ")}` : ""}. The store target keeps its write-started stop.`,
          );
          await writeFile(
            "store-target-result.json",
            JSON.stringify(failure) + "\n",
          ).catch(() => {});
        } else {
          console.error(
            "App Store submission refused; inspect the target outcome.",
          );
        }
      }
    }
  });
}
