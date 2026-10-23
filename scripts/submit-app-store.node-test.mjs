import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
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
        if (
          new URL(path, "https://fixture.test/").pathname.endsWith(
            "/appStoreReviewDetail",
          )
        ) {
          const fields = new URL(path, "https://fixture.test/").searchParams
            .get("fields[appStoreReviewDetails]")
            ?.split(",");
          assert.ok(fields?.includes("demoAccountName"));
          assert.ok(fields?.includes("demoAccountRequired"));
          assert.ok(!fields?.includes("demoAccountPassword"));
          return {
            data: f.review && {
              ...f.review,
              attributes: Object.fromEntries(
                fields
                  .filter((key) => key in f.review.attributes)
                  .map((key) => [key, f.review.attributes[key]]),
              ),
            },
          };
        }
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
      env: {},
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
    { ...metadata, draft: "not approved" },
  ]) {
    assert.throws(() => validateMetadata(m, "1.0.4"));
  }
  assert.throws(() => validateMetadata(metadata, "../secret"));
});

test("approved 1.0.9 metadata holds MANUAL release and names the migrated review collection; drafts remain refused", async () => {
  const approved = JSON.parse(
    await readFile(
      new URL("../docs/releases/ios/1.0.9.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(validateMetadata(approved, "1.0.9"), approved);
  assert.equal(approved.releaseType, "MANUAL");
  assert.ok(
    approved.reviewNotes.includes('collection "[test] C hosted tasks"'),
  );
  assert.match(approved.reviewNotes, /review account has already moved/);
  assert.throws(
    () => validateMetadata({ ...approved, draft: "not approved" }, "1.0.9"),
    /draft/,
  );
});

test("a MANUAL release is held after approval and checked on reruns", async () => {
  const held = { ...metadata, releaseType: "MANUAL" };
  const f = fixture();
  const result = await f.run({ commit: true, metadata: held });
  assert.equal(result.state, "WAITING_FOR_REVIEW");
  assert.equal(result.releaseType, "MANUAL");
  assert.equal(f.versions[1].attributes.releaseType, "MANUAL");
  const rerun = await f.run({ commit: true, metadata: held });
  assert.equal(rerun.alreadySubmitted, true);
  assert.equal(rerun.releaseType, "MANUAL");
  await assert.rejects(
    f.run({ commit: true }),
    /does not match the expected release policy/,
  );
  assert.throws(
    () => validateMetadata({ ...metadata, releaseType: "SCHEDULED" }, "1.0.4"),
    /releaseType/,
  );
});

test("rechecks the MANUAL policy after Apple confirms submission", async () => {
  const f = fixture();
  const request = f.client.request;
  f.client.request = async (path, method, data) => {
    const result = await request(path, method, data);
    if (path === "reviewSubmissions/submission" && method === "PATCH")
      f.versions[1].attributes.releaseType = "AFTER_APPROVAL";
    return result;
  };
  await assert.rejects(
    f.run({ commit: true, metadata: { ...metadata, releaseType: "MANUAL" } }),
    /Release policy changed during submission/,
  );
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

const reviewEnv = {
  APP_REVIEW_DEMO_ACCOUNT_NAME: "synthetic-review@example.test",
  APP_REVIEW_DEMO_ACCOUNT_PASSWORD: "  synthetic password\n ",
};
const assertNoSubmission = (f) =>
  assert.ok(!f.writes.some((w) => w.data.attributes?.submitted));
const assertSafeResult = (result) => {
  const serialized = JSON.stringify(result);
  for (const value of Object.values(reviewEnv)) {
    assert.ok(!serialized.includes(value));
    assert.ok(!serialized.includes(JSON.stringify(value).slice(1, -1)));
  }
  assert.ok(!serialized.includes("demoAccountPassword"));
  assert.ok(!serialized.includes('demoAccountName"'));
};

test("optional credentials are saved with notes, verified without password reads, and never returned", async () => {
  const f = fixture();
  const result = await f.run({ commit: true, env: reviewEnv });
  const patches = f.writes.filter(
    (w) => w.path === "appStoreReviewDetails/review",
  );
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].data.attributes, {
    notes: metadata.reviewNotes,
    demoAccountName: reviewEnv.APP_REVIEW_DEMO_ACCOUNT_NAME,
    demoAccountPassword: reviewEnv.APP_REVIEW_DEMO_ACCOUNT_PASSWORD,
    demoAccountRequired: true,
  });
  assert.equal(result.demoAccountNameVerified, true);
  assert.equal(result.demoAccountRequired, true);
  assertSafeResult(result);
});

test("dry run with credentials never writes or exposes credentials", async () => {
  const f = fixture();
  const result = await f.run({ env: reviewEnv });
  assert.equal(result.state, "DRY_RUN");
  assert.equal(f.writes.length, 0);
  assertSafeResult(result);
});

for (const env of [
  { APP_REVIEW_DEMO_ACCOUNT_NAME: reviewEnv.APP_REVIEW_DEMO_ACCOUNT_NAME },
  {
    APP_REVIEW_DEMO_ACCOUNT_PASSWORD:
      reviewEnv.APP_REVIEW_DEMO_ACCOUNT_PASSWORD,
  },
  { ...reviewEnv, APP_REVIEW_DEMO_ACCOUNT_NAME: "" },
  { ...reviewEnv, APP_REVIEW_DEMO_ACCOUNT_PASSWORD: "" },
  { ...reviewEnv, APP_REVIEW_DEMO_ACCOUNT_NAME: "   " },
]) {
  test("partial or invalid credential pair fails closed before API access, including dry run", async () => {
    for (const commit of [false, true]) {
      const f = fixture();
      await assert.rejects(f.run({ commit, env }), (error) => {
        assertSafeResult({ error: error.message });
        return /review credentials/i.test(error.message);
      });
      assert.equal(f.writes.length, 0);
      assert.equal(f.reads.length, 0);
    }
  });
}

for (const [field, value] of [
  ["demoAccountName", "wrong@example.test"],
  ["demoAccountName", undefined],
  ["demoAccountRequired", false],
  ["demoAccountRequired", undefined],
]) {
  test(`credential readback mismatch in ${field} blocks submission`, async () => {
    const f = fixture();
    const request = f.client.request;
    f.client.request = async (path, method, data) => {
      const result = await request(path, method, data);
      if (method === "PATCH" && path === "appStoreReviewDetails/review")
        f.review.attributes[field] = value;
      return result;
    };
    await assert.rejects(
      f.run({ commit: true, env: reviewEnv }),
      /review credentials/i,
    );
    assertNoSubmission(f);
  });
}

test("READY_FOR_REVIEW rerun verifies credentials without rewriting prepared details", async () => {
  const f = fixture();
  f.failAfter = "reviewSubmissionItems";
  await assert.rejects(
    f.run({ commit: true, env: reviewEnv }),
    /response lost/,
  );
  f.writes = [];
  f.review.attributes.demoAccountRequired = false;
  await assert.rejects(
    f.run({ commit: true, env: reviewEnv }),
    /review credentials/i,
  );
  assert.equal(f.writes.length, 0);
  f.review.attributes.demoAccountRequired = true;
  const result = await f.run({ commit: true, env: reviewEnv });
  assert.equal(result.demoAccountNameVerified, true);
  assert.ok(!f.writes.some((w) => w.path === "appStoreReviewDetails/review"));
});

test("already submitted same build verifies credentials read-only and rejects mismatches", async () => {
  const f = fixture();
  await f.run({ commit: true, env: reviewEnv });
  f.writes = [];
  for (const appStoreState of [
    "WAITING_FOR_REVIEW",
    "IN_REVIEW",
    "PENDING_APPLE_RELEASE",
    "PENDING_DEVELOPER_RELEASE",
    "READY_FOR_SALE",
  ]) {
    f.versions[1].attributes.appStoreState = appStoreState;
    for (const commit of [false, true]) {
      const result = await f.run({ commit, env: reviewEnv });
      assert.equal(result.alreadySubmitted, true);
      assert.equal(result.demoAccountNameVerified, true);
      assertSafeResult(result);
      f.review.attributes.demoAccountName = "wrong@example.test";
      await assert.rejects(
        f.run({ commit, env: reviewEnv }),
        /review credentials/i,
      );
      f.review.attributes.demoAccountName =
        reviewEnv.APP_REVIEW_DEMO_ACCOUNT_NAME;
      f.review.attributes.demoAccountRequired = false;
      await assert.rejects(
        f.run({ commit, env: reviewEnv }),
        /review credentials/i,
      );
      f.review.attributes.demoAccountRequired = true;
    }
  }
  assert.equal(f.writes.length, 0);
});

test("approved MANUAL state is a verified read-only success on reruns", async () => {
  const f = fixture();
  const held = { ...metadata, releaseType: "MANUAL" };
  await f.run({ commit: true, metadata: held, env: reviewEnv });
  f.versions[1].attributes.appStoreState = "PENDING_DEVELOPER_RELEASE";
  f.writes = [];
  for (const commit of [false, true]) {
    const result = await f.run({ commit, metadata: held, env: reviewEnv });
    assert.equal(result.state, "PENDING_DEVELOPER_RELEASE");
    assert.equal(result.releaseType, "MANUAL");
    assert.equal(result.alreadySubmitted, true);
    assert.equal(result.demoAccountNameVerified, true);
    assert.equal(result.demoAccountRequired, true);
    assertSafeResult(result);
  }
  await assert.rejects(f.run(), /expected release policy/);
  assert.equal(f.writes.length, 0);
});

test("creates version, saves metadata, attaches exact build and submits", async () => {
  const f = fixture();
  assert.equal((await f.run({ commit: true })).state, "WAITING_FOR_REVIEW");
  assert.equal(f.attached.id, "build");
  assert.equal(f.locales[0].attributes.whatsNew, "Bug fixes.");
  assert.equal(f.review.attributes.notes, metadata.reviewNotes);
  assert.deepEqual(
    f.writes.find((w) => w.path === "appStoreReviewDetails/review").data
      .attributes,
    { notes: metadata.reviewNotes },
  );
  assert.equal(f.versions[1].attributes.releaseType, "AFTER_APPROVAL");
  assert.equal(f.writes.at(-1).data.attributes.submitted, true);
  assert.ok(!f.writes.some((w) => w.method === "DELETE"));
});

for (const failAfter of [
  "appStoreReviewDetails/review",
  "reviewSubmissionItems",
  "reviewSubmissions/submission",
]) {
  test(`credential policy survives a lost response after ${failAfter}`, async () => {
    const f = fixture();
    f.failAfter = failAfter;
    await assert.rejects(
      f.run({ commit: true, env: reviewEnv }),
      /response lost/,
    );
    const result = await f.run({ commit: true, env: reviewEnv });
    assert.equal(result.demoAccountNameVerified, true);
    assert.equal(result.demoAccountRequired, true);
    assert.equal(f.versions.length, 2);
    assert.equal(f.items.length, 1);
    assert.equal(f.submissions.length, 1);
    assertSafeResult(result);
  });
}

test("empty optional environment secrets preserve notes-only updates", async () => {
  const f = fixture();
  await f.run({
    commit: true,
    env: {
      APP_REVIEW_DEMO_ACCOUNT_NAME: "",
      APP_REVIEW_DEMO_ACCOUNT_PASSWORD: "",
    },
  });
  assert.deepEqual(
    f.writes.find((w) => w.path === "appStoreReviewDetails/review").data
      .attributes,
    { notes: metadata.reviewNotes },
  );
});

test("production workflow wires both optional review credentials only into the submission step", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/app-store-submit.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: app-store-production/);
  for (const key of Object.keys(reviewEnv)) {
    assert.ok(workflow.includes(`${key}: \${{ secrets.${key} }}`));
    assert.equal(workflow.split(key).length - 1, 2);
  }
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
