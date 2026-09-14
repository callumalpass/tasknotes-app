import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  APP_ID,
  BUNDLE_ID,
  createClient,
  createToken,
  submitAppStore,
  validateMetadata,
  waitForBuild,
} from "./submit-app-store.mjs";

const metadata = {
  version: "1.0.4",
  copyright: "2026 Callum Alpass",
  reviewNotes: "Try a disposable demo.",
  whatsNew: { "en-AU": "Bug fixes." },
};
const rel = (type, id) => ({ data: { type, id } });
function fixture() {
  const old = {
    id: "old",
    attributes: { versionString: "1.0.3", appStoreState: "READY_FOR_SALE" },
  };
  const build = {
    id: "build",
    attributes: {
      version: "15",
      processingState: "VALID",
      expired: false,
      buildAudienceType: "APP_STORE_ELIGIBLE",
      usesNonExemptEncryption: false,
    },
  };
  const f = {
    versions: [old],
    build,
    writes: [],
    reads: [],
    submissions: [],
    items: [],
    attached: null,
    phased: null,
    locales: [
      { id: "locale", attributes: { locale: "en-AU", whatsNew: "Old notes" } },
    ],
    review: {
      id: "review",
      attributes: {
        notes: "Old review notes",
        contactEmail: "review@example.test",
        contactFirstName: "A",
        contactLastName: "B",
        contactPhone: "123",
      },
    },
  };
  const target = () => f.versions.find((v) => v.id === "new");
  f.client = {
    async list(path) {
      f.reads.push(path);
      if (path.startsWith("builds?")) return f.build ? [f.build] : [];
      if (path.includes("/appStoreVersions?")) return f.versions;
      if (path.includes("/appStoreVersionLocalizations")) return f.locales;
      if (path.startsWith("reviewSubmissions?")) return f.submissions;
      if (path.includes("/items?")) return f.items;
      throw new Error(`Unexpected list ${path}`);
    },
    async request(path, method = "GET", data) {
      if (method === "GET") {
        f.reads.push(path);
        if (path === `apps/${APP_ID}`)
          return {
            data: { attributes: { bundleId: f.bundleId ?? BUNDLE_ID } },
          };
        if (path.endsWith("/relationships/build")) return { data: f.attached };
        if (path.endsWith("/appStoreReviewDetail")) return { data: f.review };
        if (path.endsWith("/relationships/appStoreVersionPhasedRelease"))
          return { data: f.phased };
        if (path === "appStoreVersions/new") return { data: target() };
        throw new Error(`Unexpected GET ${path}`);
      }
      f.writes.push({ path, method, data });
      let result = {};
      if (path === "appStoreVersions" && method === "POST") {
        const v = {
          id: "new",
          attributes: {
            ...data.attributes,
            appStoreState: "PREPARE_FOR_SUBMISSION",
          },
        };
        f.versions.push(v);
        result = { data: v };
      } else if (path === "appStoreVersions/new") {
        Object.assign(target().attributes, data.attributes);
        f.attached = data.relationships.build.data;
      } else if (path === "appStoreVersionLocalizations/locale") {
        Object.assign(f.locales[0].attributes, data.attributes);
      } else if (path === "appStoreReviewDetails/review") {
        Object.assign(f.review.attributes, data.attributes);
      } else if (path === "reviewSubmissions" && method === "POST") {
        const submission = {
          id: "submission",
          attributes: { state: "READY_FOR_REVIEW" },
        };
        f.submissions.push(submission);
        result = { data: submission };
      } else if (path === "reviewSubmissionItems") {
        f.items.push({ id: "item", relationships: data.relationships });
        target().attributes.appStoreState = "READY_FOR_REVIEW";
      } else if (
        path === "reviewSubmissions/submission" &&
        data.attributes.submitted
      ) {
        target().attributes.appStoreState = "WAITING_FOR_REVIEW";
        f.submissions[0].attributes.state = "WAITING_FOR_REVIEW";
      } else throw new Error(`Unexpected write ${path}`);
      if (f.failAfter === path) {
        f.failAfter = null;
        throw new Error("Network response lost after write");
      }
      return result;
    },
  };
  f.run = (options = {}) =>
    submitAppStore({
      client: f.client,
      version: "1.0.4",
      buildNumber: "15",
      metadata,
      waitOptions: { attempts: 1 },
      ...options,
    });
  return f;
}

test("requires version-specific complete release metadata", () => {
  assert.equal(validateMetadata(metadata, "1.0.4"), metadata);
  for (const m of [
    { ...metadata, version: "1.0.3" },
    { ...metadata, reviewNotes: "" },
    { ...metadata, whatsNew: {} },
    { ...metadata, whatsNew: { "en-AU": "x".repeat(4001) } },
  ]) {
    assert.throws(() => validateMetadata(m, "1.0.4"));
  }
  assert.throws(() => validateMetadata(metadata, "../secret"));
});

test("dry run never writes", async () => {
  const f = fixture();
  assert.equal((await f.run()).state, "DRY_RUN");
  assert.equal(f.writes.length, 0);
  assert.ok(
    f.reads.some((path) =>
      path.includes("filter%5BpreReleaseVersion.version%5D=1.0.4"),
    ),
  );
});

test("creates version, saves metadata, attaches exact build and submits", async () => {
  const f = fixture();
  assert.equal((await f.run({ commit: true })).state, "WAITING_FOR_REVIEW");
  assert.equal(f.attached.id, "build");
  assert.equal(f.locales[0].attributes.whatsNew, "Bug fixes.");
  assert.equal(f.review.attributes.notes, metadata.reviewNotes);
  assert.equal(f.versions[1].attributes.releaseType, "AFTER_APPROVAL");
  assert.equal(f.writes.at(-1).data.attributes.submitted, true);
  assert.ok(!f.writes.some((w) => w.method === "DELETE"));
});

for (const failAfter of [
  "appStoreVersions",
  "appStoreVersions/new",
  "appStoreVersionLocalizations/locale",
  "appStoreReviewDetails/review",
  "reviewSubmissions",
  "reviewSubmissionItems",
  "reviewSubmissions/submission",
]) {
  test(`rerun reconciles a lost response after ${failAfter}`, async () => {
    const f = fixture();
    f.failAfter = failAfter;
    await assert.rejects(f.run({ commit: true }), /response lost/);
    assert.equal((await f.run({ commit: true })).state, "WAITING_FOR_REVIEW");
    assert.equal(f.versions.length, 2);
    assert.equal(f.items.length, 1);
    assert.equal(f.submissions.length, 1);
  });
}

test("already submitted same build is a read-only success", async () => {
  const f = fixture();
  await f.run({ commit: true });
  f.writes = [];
  assert.equal((await f.run({ commit: true })).alreadySubmitted, true);
  assert.equal(f.writes.length, 0);
});

for (const [label, change, expected] of [
  [
    "wrong app",
    (f) => {
      f.bundleId = "another.app";
    },
    /bundle ID/,
  ],
  [
    "wrong build",
    (f) => {
      f.build.attributes.version = "16";
    },
    /mismatched/,
  ],
  [
    "expired build",
    (f) => {
      f.build.attributes.expired = true;
    },
    /expired/,
  ],
  [
    "failed processing",
    (f) => {
      f.build.attributes.processingState = "FAILED";
    },
    /invalid/,
  ],
  [
    "missing encryption declaration",
    (f) => {
      f.build.attributes.usesNonExemptEncryption = null;
    },
    /export-compliance/,
  ],
  [
    "internal-only build",
    (f) => {
      f.build.attributes.buildAudienceType = "INTERNAL_ONLY";
    },
    /eligibility/,
  ],
  [
    "missing build",
    (f) => {
      f.build = null;
    },
    /Timed out/,
  ],
  [
    "untranslated locale",
    (f) => {
      f.locales.push({ id: "fr", attributes: { locale: "fr-FR" } });
    },
    /all existing store locales/,
  ],
  [
    "missing contacts",
    (f) => {
      delete f.review.attributes.contactEmail;
    },
    /contact information/,
  ],
  [
    "other in-flight version",
    (f) => {
      f.versions.push({
        id: "other",
        attributes: { versionString: "2.0.0", appStoreState: "IN_REVIEW" },
      });
    },
    /Another iOS/,
  ],
  [
    "unrelated draft item",
    (f) => {
      f.submissions.push({
        id: "submission",
        attributes: { state: "READY_FOR_REVIEW" },
      });
      f.items.push({
        relationships: { appStoreVersion: rel("appStoreVersions", "other") },
      });
    },
    /unrelated items/,
  ],
]) {
  test(`refuses ${label} before mutation`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(f.run({ commit: true }), expected);
    assert.equal(f.writes.length, 0);
  });
}

test("does not replace an attached build", async () => {
  const f = fixture();
  await f.run({ commit: true });
  f.writes = [];
  f.attached.id = "different";
  await assert.rejects(f.run({ commit: true }), /different build/);
  assert.equal(f.writes.length, 0);
});

test("does not silently submit a phased release", async () => {
  const f = fixture();
  f.phased = { id: "phase" };
  await assert.rejects(f.run({ commit: true }), /phased release/);
  assert.ok(!f.writes.some((w) => w.data.attributes?.submitted));
});

test("bounded build processing polling", async () => {
  const f = fixture();
  let polls = 0;
  f.build.attributes.processingState = "PROCESSING";
  const result = await waitForBuild(f.client, "1.0.4", "15", {
    attempts: 3,
    sleepImpl: async () => {
      polls++;
      f.build.attributes.processingState = "VALID";
    },
  });
  assert.equal(result.id, "build");
  assert.equal(polls, 1);
});

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const credentials = { privateKey, keyId: "TESTKEY", issuerId: "test-issuer" };
test("Apple ES256 JWT uses raw P1363 signature and short expiry", () => {
  const token = createToken(credentials, 1_000_000);
  const [header, payload, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).kid, "TESTKEY");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).exp, 1600);
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
});

test("pagination and retry never leak credentials to other origins", async () => {
  const calls = [];
  const client = createClient(credentials, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          links: { next: "https://evil.test/v1/apps" },
        }),
      };
    },
  });
  await assert.rejects(client.list("apps"), /Unexpected App Store Connect URL/);
  assert.equal(calls.length, 1);
});

test("retries transient reads but not writes; redacts error details", async () => {
  let calls = 0;
  const client = createClient(credentials, {
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return {
        ok: false,
        status: 503,
        json: async () => ({
          errors: [{ code: "UNAVAILABLE", detail: "secret" }],
        }),
      };
    },
  });
  await assert.rejects(
    client.request("apps"),
    (error) => !error.message.includes("secret"),
  );
  assert.equal(calls, 5);
  calls = 0;
  await assert.rejects(client.request("appStoreVersions", "POST", {}));
  assert.equal(calls, 1);
});
