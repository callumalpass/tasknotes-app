import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ID,
  BUNDLE_ID,
  createClient,
  createToken,
  refusalReason,
  refusalReceipt,
  submitAppStore,
  trackWrites,
  validateMetadata,
  withListingNotes,
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
      {
        id: "locale",
        attributes: {
          locale: "en-AU",
          whatsNew: "Old notes",
          description: "Old description",
          keywords: "old",
          promotionalText: "Old promo",
          supportUrl: "https://tasknotes.dev/support",
          marketingUrl: "https://tasknotes.dev",
        },
      },
    ],
    appInfos: [
      { id: "info-live", attributes: { state: "READY_FOR_DISTRIBUTION" } },
    ],
    infoLocales: [
      {
        id: "info-locale",
        attributes: {
          locale: "en-AU",
          name: "TaskNotes",
          subtitle: "Old subtitle",
          privacyPolicyUrl: "https://tasknotes.dev/privacy",
        },
      },
    ],
    sets: [],
    shots: {},
    shotCount: 0,
    uploads: [],
    processResult: "COMPLETE",
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
      if (path.endsWith("/appScreenshotSets"))
        return f.sets.filter((set) => set.localization === path.split("/")[1]);
      if (path.endsWith("/appScreenshots")) {
        // Apple finishes processing a committed upload between reads, and
        // publishes its checksum a couple of reads after that.
        const shots = f.shots[path.split("/")[1]] ?? [];
        for (const shot of shots) {
          if (f.holdProcessing) continue;
          const delivery = shot.attributes.assetDeliveryState;
          if (
            delivery.state === "COMPLETE" &&
            shot.pendingChecksum &&
            --shot.checksumReads <= 0
          ) {
            shot.attributes.sourceFileChecksum = shot.pendingChecksum;
            delete shot.pendingChecksum;
          }
          if (delivery.state === "UPLOAD_COMPLETE")
            delivery.state = f.processResult;
        }
        return shots.map((shot) => ({
          id: shot.id,
          attributes: shot.attributes,
        }));
      }
      if (path.startsWith("builds?")) return f.build ? [f.build] : [];
      if (path.includes("/appStoreVersions?")) return f.versions;
      if (path.includes("/appStoreVersionLocalizations")) return f.locales;
      if (path === `apps/${APP_ID}/appInfos`) return f.appInfos;
      if (path.endsWith("/appInfoLocalizations")) return f.infoLocales;
      if (path.startsWith("reviewSubmissions?")) return f.submissions;
      if (path.includes("/items?")) return f.items;
      throw new Error(`Unexpected list ${path}`);
    },
    async request(path, method = "GET", data) {
      if (method === "GET") {
        f.reads.push(path);
        if (path === `apps/${APP_ID}`)
          return {
            data: {
              attributes: {
                bundleId: f.bundleId ?? BUNDLE_ID,
                primaryLocale: "en-AU",
              },
            },
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
        // Apple opens an editable app info alongside a new version.
        f.appInfos.push({
          id: "info-new",
          attributes: { state: "PREPARE_FOR_SUBMISSION" },
        });
        result = { data: v };
      } else if (path === "appStoreVersions/new") {
        Object.assign(target().attributes, data.attributes);
        f.attached = data.relationships.build.data;
      } else if (path.startsWith("appStoreVersionLocalizations/")) {
        const id = path.split("/")[1];
        Object.assign(
          f.locales.find((item) => item.id === id).attributes,
          data.attributes,
        );
      } else if (path === "appStoreVersionLocalizations" && method === "POST") {
        assert.equal(data.relationships.appStoreVersion.data.id, "new");
        const created = {
          id: `locale-${data.attributes.locale}`,
          attributes: { ...data.attributes },
        };
        f.locales.push(created);
        result = { data: created };
      } else if (path.startsWith("appInfoLocalizations/")) {
        const id = path.split("/")[1];
        Object.assign(
          f.infoLocales.find((item) => item.id === id).attributes,
          data.attributes,
        );
      } else if (path === "appInfoLocalizations" && method === "POST") {
        assert.equal(data.relationships.appInfo.data.id, "info-new");
        const created = {
          id: `info-${data.attributes.locale}`,
          attributes: { ...data.attributes },
        };
        f.infoLocales.push(created);
        result = { data: created };
      } else if (path === "appScreenshotSets" && method === "POST") {
        const set = {
          id: `set-${data.attributes.screenshotDisplayType}`,
          localization: data.relationships.appStoreVersionLocalization.data.id,
          attributes: { ...data.attributes },
        };
        f.sets.push(set);
        f.shots[set.id] = [];
        result = { data: set };
      } else if (path === "appScreenshots" && method === "POST") {
        const shot = {
          id: `shot-${++f.shotCount}`,
          attributes: {
            ...data.attributes,
            assetDeliveryState: { state: "AWAITING_UPLOAD" },
            uploadOperations: [
              {
                method: "PUT",
                url: `https://upload.example.test/${f.shotCount}`,
                offset: 0,
                length: data.attributes.fileSize,
                requestHeaders: [{ name: "Content-Type", value: "image/png" }],
              },
            ],
          },
        };
        f.shots[data.relationships.appScreenshotSet.data.id].push(shot);
        result = { data: shot };
      } else if (path.startsWith("appScreenshots/") && method === "PATCH") {
        const shot = Object.values(f.shots)
          .flat()
          .find((item) => item.id === path.split("/")[1]);
        assert.ok(f.uploads.includes(shot.id.replace("shot-", "")));
        assert.equal(data.attributes.uploaded, true);
        shot.pendingChecksum = data.attributes.sourceFileChecksum;
        shot.checksumReads = 2;
        shot.attributes.assetDeliveryState.state = "UPLOAD_COMPLETE";
      } else if (path.startsWith("appScreenshots/") && method === "DELETE") {
        for (const [id, shots] of Object.entries(f.shots))
          f.shots[id] = shots.filter((item) => item.id !== path.split("/")[1]);
      } else if (
        path.startsWith("appScreenshotSets/") &&
        path.endsWith("/relationships/appScreenshots")
      ) {
        const id = path.split("/")[1];
        f.shots[id] = data.map((ref) =>
          f.shots[id].find((item) => item.id === ref.id),
        );
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

test("manual or scheduled release policy cannot replace automatic release", () => {
  for (const releaseType of ["MANUAL", "SCHEDULED"])
    assert.throws(
      () => validateMetadata({ ...metadata, releaseType }, "1.0.4"),
      /AFTER_APPROVAL/,
    );
});

test("rechecks automatic release policy after Apple confirms submission", async () => {
  const fixtureValue = fixture();
  const request = fixtureValue.client.request;
  fixtureValue.client.request = async (path, method, data) => {
    const result = await request(path, method, data);
    if (path === "reviewSubmissions/submission" && method === "PATCH")
      fixtureValue.versions[1].attributes.releaseType = "MANUAL";
    return result;
  };
  await assert.rejects(
    fixtureValue.run({ commit: true }),
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
    /earlier-store-version-in-flight/,
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

test("pre-write refusals map to fixed bounded reasons", () => {
  for (const [message, reason] of [
    [
      "Build needs App Store eligibility or an export-compliance declaration; resolve in App Store Connect",
      "app-store-build-not-eligible",
    ],
    [
      "Timed out waiting for the exact build to finish processing; rerun only the submission job later",
      "app-store-build-processing-timeout",
    ],
    [
      "Store version needs manual attention: DEVELOPER_REJECTED",
      "app-store-version-needs-attention-developer-rejected",
    ],
    [
      "App Store Connect GET /v1/builds: HTTP 401 (NOT_AUTHORIZED). Check the listing in App Store Connect; no automatic cancellation or replacement was attempted.",
      "app-store-read-http-401",
    ],
    ["Something unexpected: details", "app-store-precheck-refused-error"],
  ])
    assert.equal(refusalReason(new Error(message)), reason);
  for (const reason of ["store-listing-invalid", "store-media-invalid"])
    assert.equal(
      refusalReason(Object.assign(new Error("details"), { refusal: reason })),
      reason,
    );
});

const rejectsWith = async (promise, reason) =>
  assert.equal(
    refusalReason(
      await promise.then(
        () => assert.fail("expected refusal"),
        (e) => e,
      ),
    ),
    reason,
  );

test("hung or failed reads retry with backoff, then refuse with a bounded slug", async () => {
  const timeout = () =>
    new DOMException("The operation timed out.", "TimeoutError");
  const abort = () => new DOMException("aborted", "AbortError");
  const network = () =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNRESET 10.0.0.1"), {
        code: "ECONNRESET",
      }),
    });
  const undici = () =>
    Object.assign(new Error("Connect Timeout Error"), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
  for (const [failure, reason] of [
    [timeout, "app-store-read-timeout"],
    [abort, "app-store-read-timeout"],
    [undici, "app-store-read-timeout"],
    [network, "app-store-read-network"],
  ]) {
    let calls = 0;
    const delays = [];
    const client = createClient(credentials, {
      sleepImpl: async (ms) => delays.push(ms),
      fetchImpl: async () => {
        calls++;
        throw failure();
      },
    });
    await rejectsWith(client.request("apps"), reason);
    assert.equal(calls, 5);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  }
  // A transient failure followed by success returns the read.
  let calls = 0;
  const client = createClient(credentials, {
    sleepImpl: async () => {},
    fetchImpl: async () => {
      if (++calls < 3) throw calls === 1 ? timeout() : network();
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "1" } }),
      };
    },
  });
  assert.deepEqual(await client.request("apps"), { data: { id: "1" } });
  assert.equal(calls, 3);
});

test("a hung body read is retried like a hung request", async () => {
  let calls = 0;
  const client = createClient(credentials, {
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      };
    },
  });
  await rejectsWith(client.request("apps"), "app-store-read-timeout");
  assert.equal(calls, 5);
});

test("writes are never retried on network or timeout errors", async () => {
  for (const method of ["POST", "PATCH"]) {
    for (const failure of [
      () => new TypeError("fetch failed"),
      () => new DOMException("timed out", "TimeoutError"),
    ]) {
      let calls = 0;
      let slept = 0;
      const client = createClient(credentials, {
        sleepImpl: async () => slept++,
        fetchImpl: async () => {
          calls++;
          throw failure();
        },
      });
      await assert.rejects(client.request("appStoreVersions", method, {}));
      assert.equal(calls, 1);
      assert.equal(slept, 0);
    }
  }
});

test("unparseable responses and pagination faults refuse with bounded slugs", async () => {
  const client = createClient(credentials, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse("<html>secret</html>"),
    }),
  });
  await rejectsWith(client.request("apps"), "app-store-read-unparseable");
  const offsite = createClient(credentials, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [],
        links: { next: "https://evil.test/v1/apps" },
      }),
    }),
  });
  await rejectsWith(
    offsite.list("apps"),
    "app-store-pagination-url-unexpected",
  );
  const looping = createClient(credentials, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [], links: { next: "apps" } }),
    }),
  });
  await rejectsWith(looping.list("apps"), "app-store-pagination-repeated");
});

test("an unusable signing key refuses as an invalid auth key before any request", async () => {
  let calls = 0;
  const client = createClient(
    { ...credentials, privateKey: "not a key" },
    { fetchImpl: async () => calls++ },
  );
  await rejectsWith(client.request("apps"), "app-store-auth-key-invalid");
  assert.equal(calls, 0);
});

test("metadata validation failures share one bounded slug", () => {
  for (const broken of [
    [{ ...metadata }, "1.0"],
    [{ ...metadata, version: "1.0.5" }, "1.0.4"],
    [{ ...metadata, draft: true }, "1.0.4"],
    [{ ...metadata, releaseType: "MANUAL" }, "1.0.4"],
    [{ ...metadata, copyright: " " }, "1.0.4"],
    [{ ...metadata, reviewNotes: "x".repeat(4001) }, "1.0.4"],
    [{ ...metadata, whatsNew: [] }, "1.0.4"],
    [{ ...metadata, whatsNew: {} }, "1.0.4"],
    [{ ...metadata, whatsNew: { EN: "x" } }, "1.0.4"],
    [{ ...metadata, whatsNew: { "en-AU": "" } }, "1.0.4"],
  ]) {
    let error;
    try {
      validateMetadata(...broken);
    } catch (caught) {
      error = caught;
    }
    assert.equal(refusalReason(error), "app-store-metadata-invalid");
  }
});

test("unclassified failures name only a fixed error class", () => {
  for (const [error, reason] of [
    [
      new TypeError("x of undefined /home/secret"),
      "app-store-precheck-refused-typeerror",
    ],
    [new RangeError("secret"), "app-store-precheck-refused-rangeerror"],
    [new SyntaxError("secret"), "app-store-precheck-refused-syntaxerror"],
    [
      Object.assign(new Error("secret"), { name: "SecretError" }),
      "app-store-precheck-refused-other",
    ],
    [
      Object.assign(new Error("x"), { refusal: "not-a-known-slug" }),
      "app-store-precheck-refused-error",
    ],
    [undefined, "app-store-precheck-refused-other"],
  ])
    assert.equal(refusalReason(error), reason);
});

test("a refusal receipt is retained only while no write was attempted", async () => {
  const client = trackWrites({
    request: async () => ({}),
    list: async () => [],
  });
  const error = new Error("Selected build is invalid, expired, or mismatched");
  await client.request("apps/x");
  await client.list("apps");
  assert.deepEqual(await refusalReceipt(error, client, "42"), {
    outcome: "refused-before-write",
    reason: "app-store-build-invalid",
    source_run_id: 42,
  });
  // Credentials can fail before any client exists; that is also pre-write.
  assert.equal(
    (await refusalReceipt(error, undefined, "42")).reason,
    "app-store-build-invalid",
  );
  assert.equal(await refusalReceipt(error, client, undefined), null);
  await client.request("appStoreVersions", "POST", {}).catch(() => {});
  assert.equal(client.writeAttempted, true);
  assert.equal(await refusalReceipt(error, client, "42"), null);
});

test("a write that throws before reaching Apple still counts as attempted", async () => {
  const client = trackWrites({
    request: async () => {
      throw new Error("network");
    },
    list: async () => [],
  });
  await assert.rejects(client.request("reviewSubmissions", "POST", {}));
  assert.equal(await refusalReceipt(new Error("network"), client, "42"), null);
});

test("submitAppStore routes every write through the tracked client", async () => {
  const f = fixture();
  const client = trackWrites(f.client);
  await submitAppStore({
    client,
    version: "1.0.4",
    buildNumber: "15",
    metadata,
    commit: false,
    env: {},
  });
  assert.equal(client.writeAttempted, false);
  await submitAppStore({
    client,
    version: "1.0.4",
    buildNumber: "15",
    metadata,
    commit: true,
    env: {},
  });
  assert.equal(client.writeAttempted, true);
});

test("the submission CLI writes only the bounded pre-write refusal receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tasknotes-app-store-"));
  try {
    for (const [sourceRunId, written] of [
      ["42", true],
      [undefined, false],
    ]) {
      await rm(join(directory, "store-target-result.json"), { force: true });
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./submit-app-store.mjs", import.meta.url)),
          "--submit",
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            ...(sourceRunId ? { SOURCE_RUN_ID: sourceRunId } : {}),
          },
        },
      );
      assert.equal(result.status, 1);
      assert.equal(
        result.stderr,
        written
          ? "App Store submission refused before any write: app-store-config-missing\n"
          : "App Store submission refused; inspect the target outcome.\n",
      );
      const receipt = await readFile(
        join(directory, "store-target-result.json"),
        "utf8",
      ).catch(() => null);
      assert.deepEqual(
        receipt && JSON.parse(receipt),
        written
          ? {
              outcome: "refused-before-write",
              reason: "app-store-config-missing",
              source_run_id: 42,
            }
          : null,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const listingEntry = (suffix) => ({
  name: `TaskNotes ${suffix}`,
  subtitle: `Subtitle ${suffix}`,
  keywords: `tasks,${suffix}`,
  promotionalText: `Promo ${suffix}`,
  description: `Description ${suffix}`,
  whatsNew: `Notes ${suffix}`,
});
const listing = { "en-AU": listingEntry("au"), "fr-FR": listingEntry("fr") };
const listingMetadata = {
  ...metadata,
  whatsNew: { "en-AU": "Notes au", "fr-FR": "Notes fr" },
};

test("applies repository listing text and creates its new locales", async () => {
  const f = fixture();
  const result = await f.run({
    commit: true,
    metadata: listingMetadata,
    listing,
  });
  assert.equal(result.state, "WAITING_FOR_REVIEW");
  const au = f.locales.find((item) => item.attributes.locale === "en-AU");
  assert.equal(au.attributes.description, "Description au");
  assert.equal(au.attributes.keywords, "tasks,au");
  assert.equal(au.attributes.promotionalText, "Promo au");
  assert.equal(au.attributes.whatsNew, "Notes au");
  const fr = f.locales.find((item) => item.attributes.locale === "fr-FR");
  assert.deepEqual(fr.attributes, {
    locale: "fr-FR",
    description: "Description fr",
    keywords: "tasks,fr",
    promotionalText: "Promo fr",
    whatsNew: "Notes fr",
    supportUrl: "https://tasknotes.dev/support",
    marketingUrl: "https://tasknotes.dev",
  });
  const auInfo = f.infoLocales.find(
    (item) => item.attributes.locale === "en-AU",
  );
  assert.equal(auInfo.attributes.name, "TaskNotes au");
  assert.equal(auInfo.attributes.subtitle, "Subtitle au");
  const frInfo = f.infoLocales.find(
    (item) => item.attributes.locale === "fr-FR",
  );
  assert.deepEqual(frInfo.attributes, {
    locale: "fr-FR",
    name: "TaskNotes fr",
    subtitle: "Subtitle fr",
    privacyPolicyUrl: "https://tasknotes.dev/privacy",
  });
  // The live app info is never written.
  assert.ok(!f.writes.some((w) => w.path.includes("info-live")));
  assert.ok(!f.writes.some((w) => w.method === "DELETE"));
});

test("listing reruns after a lost response do not duplicate locales", async () => {
  for (const failAfter of [
    "appStoreVersionLocalizations",
    "appInfoLocalizations",
    "appInfoLocalizations/info-locale",
  ]) {
    const f = fixture();
    f.failAfter = failAfter;
    await assert.rejects(
      f.run({ commit: true, metadata: listingMetadata, listing }),
      /response lost/,
    );
    assert.equal(
      (await f.run({ commit: true, metadata: listingMetadata, listing })).state,
      "WAITING_FOR_REVIEW",
    );
    assert.equal(f.locales.length, 2);
    assert.equal(f.infoLocales.length, 2);
  }
});

test("a noted locale without listing text still needs App Store Connect setup", async () => {
  const f = fixture();
  await assert.rejects(
    f.run({
      commit: true,
      metadata: listingMetadata,
      listing: { "en-AU": listing["en-AU"] },
    }),
    /Release notes must cover exactly/,
  );
  assert.equal(f.writes.length, 0);
});

test("a store locale missing from the release notes refuses before writing", async () => {
  const f = fixture();
  f.locales.push({ id: "de", attributes: { locale: "de-DE", whatsNew: "x" } });
  await assert.rejects(
    f.run({ commit: true, metadata: listingMetadata, listing }),
    /Release notes must cover exactly/,
  );
  assert.equal(f.writes.length, 0);
});

test("listing text that does not read back blocks submission", async () => {
  const f = fixture();
  const request = f.client.request;
  f.client.request = async (path, method, data) => {
    if (path === "appInfoLocalizations/info-locale" && method === "PATCH")
      data = { ...data, attributes: { ...data.attributes, subtitle: "Other" } };
    return request(path, method, data);
  };
  await assert.rejects(
    f.run({ commit: true, metadata: listingMetadata, listing }),
    /Saved release metadata\/build does not match/,
  );
  assert.ok(!f.writes.some((w) => w.path === "reviewSubmissionItems"));
});

test("rolling notes already live fall back to the version line", async () => {
  const f = fixture();
  f.locales[0].attributes.whatsNew = "Notes au";
  await f.run({ commit: true, metadata: listingMetadata, listing });
  const byLocale = Object.fromEntries(
    f.locales.map((item) => [item.attributes.locale, item.attributes.whatsNew]),
  );
  assert.deepEqual(byLocale, {
    "en-AU": "TaskNotes 1.0.4.",
    "fr-FR": "Notes fr",
  });
});

test("read-back ignores line-ending and Unicode-form differences", async () => {
  const f = fixture();
  const request = f.client.request;
  f.client.request = async (path, method, data) => {
    if (data?.attributes?.description)
      data = {
        ...data,
        attributes: {
          ...data.attributes,
          description: `${data.attributes.description.replaceAll("\n", "\r\n")}\n`,
        },
      };
    return request(path, method, data);
  };
  const multiline = {
    "en-AU": { ...listing["en-AU"], description: "Line one\nLine two" },
    "fr-FR": listing["fr-FR"],
  };
  assert.equal(
    (
      await f.run({
        commit: true,
        metadata: listingMetadata,
        listing: multiline,
      })
    ).state,
    "WAITING_FOR_REVIEW",
  );
});

test("dry run reports the planned listing changes without writing", async () => {
  const f = fixture();
  const result = await f.run({ metadata: listingMetadata, listing });
  assert.equal(result.state, "DRY_RUN");
  assert.deepEqual(result.listingPlan.createLocales, ["fr-FR"]);
  assert.deepEqual(result.listingPlan.updateLocales, ["en-AU"]);
  assert.equal(f.writes.length, 0);
});

test("an app info locale without a privacy URL gets the existing one", async () => {
  const f = fixture();
  f.infoLocales.push({
    id: "info-fr",
    attributes: {
      locale: "fr-FR",
      name: "TaskNotes fr",
      subtitle: "Subtitle fr",
    },
  });
  await f.run({ commit: true, metadata: listingMetadata, listing });
  assert.equal(
    f.infoLocales.find((item) => item.id === "info-fr").attributes
      .privacyPolicyUrl,
    "https://tasknotes.dev/privacy",
  );
});

test("explicit notes apply to every locale of the same language file", () => {
  const english = { whatsNew: "Rolling English." };
  const french = { whatsNew: "Notes françaises." };
  assert.deepEqual(
    withListingNotes({ "en-AU": "Specific notes." }, "1.0.5", {
      "en-AU": english,
      "en-US": english,
      "fr-FR": french,
      "de-DE": {},
    }),
    {
      "en-AU": "Specific notes.",
      "en-US": "Specific notes.",
      "fr-FR": "Notes françaises.",
      "de-DE": "TaskNotes 1.0.5.",
    },
  );
});

const png = (name) => {
  const bytes = Buffer.from(`fake ${name}`);
  return {
    fileName: `${name}.png`,
    bytes,
    md5: createHash("md5").update(bytes).digest("hex"),
  };
};
const media = {
  APP_IPHONE_67: [png("phone-1"), png("phone-2")],
  APP_IPAD_PRO_3GEN_129: [png("ipad-1")],
};
const mediaOptions = (f) => ({
  attempts: 3,
  sleepImpl: async () => {},
  upload: async (url, init) => {
    assert.equal(url.origin, "https://upload.example.test");
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers["Content-Type"], "image/png");
    assert.ok(
      Object.values(media)
        .flat()
        .some((file) => file.bytes.equals(init.body)),
    );
    f.uploads.push(url.pathname.slice(1));
    return { ok: true, status: 200 };
  },
});
const checksums = (f, type) =>
  f.shots[`set-${type}`].map((shot) => shot.attributes.sourceFileChecksum);

test("uploads store screenshots to the primary locale and empties stale device sets", async () => {
  const f = fixture();
  f.sets.push(
    {
      id: "set-old-phone",
      localization: "locale",
      attributes: { screenshotDisplayType: "APP_IPHONE_65" },
    },
    {
      id: "set-watch",
      localization: "locale",
      attributes: { screenshotDisplayType: "APP_WATCH_ULTRA" },
    },
  );
  f.shots["set-old-phone"] = [
    {
      id: "old-1",
      attributes: {
        sourceFileChecksum: "stale",
        assetDeliveryState: { state: "COMPLETE" },
      },
    },
  ];
  f.shots["set-watch"] = [
    {
      id: "watch-1",
      attributes: {
        sourceFileChecksum: "watch",
        assetDeliveryState: { state: "COMPLETE" },
      },
    },
  ];
  const result = await f.run({
    commit: true,
    media,
    mediaOptions: mediaOptions(f),
  });
  assert.equal(result.state, "WAITING_FOR_REVIEW");
  assert.deepEqual(
    checksums(f, "APP_IPHONE_67"),
    media.APP_IPHONE_67.map((file) => file.md5),
  );
  assert.deepEqual(
    checksums(f, "APP_IPAD_PRO_3GEN_129"),
    media.APP_IPAD_PRO_3GEN_129.map((file) => file.md5),
  );
  assert.deepEqual(f.shots["set-old-phone"], []);
  // Sets that are not iPhone or iPad screenshots are left alone.
  assert.equal(f.shots["set-watch"].length, 1);
  assert.equal(f.uploads.length, 3);
  const submitted = f.writes.findIndex(
    (w) => w.path === "reviewSubmissionItems",
  );
  assert.ok(
    f.writes.findLastIndex((w) => w.path.startsWith("appScreenshot")) <
      submitted,
  );
});

test("unchanged screenshots are not uploaded again", async () => {
  const f = fixture();
  for (const [type, files] of Object.entries(media)) {
    f.sets.push({
      id: `set-${type}`,
      localization: "locale",
      attributes: { screenshotDisplayType: type },
    });
    f.shots[`set-${type}`] = files.map((file, index) => ({
      id: `${type}-${index}`,
      attributes: {
        sourceFileChecksum: file.md5,
        assetDeliveryState: { state: "COMPLETE" },
      },
    }));
  }
  await f.run({ commit: true, media, mediaOptions: mediaOptions(f) });
  assert.ok(!f.writes.some((w) => w.path.startsWith("appScreenshot")));
});

test("reordered screenshots are replaced in repository order", async () => {
  const f = fixture();
  f.sets.push({
    id: "set-APP_IPHONE_67",
    localization: "locale",
    attributes: { screenshotDisplayType: "APP_IPHONE_67" },
  });
  f.shots["set-APP_IPHONE_67"] = [...media.APP_IPHONE_67]
    .reverse()
    .map((file, index) => ({
      id: `existing-${index}`,
      attributes: {
        sourceFileChecksum: file.md5,
        assetDeliveryState: { state: "COMPLETE" },
      },
    }));
  await f.run({ commit: true, media, mediaOptions: mediaOptions(f) });
  assert.deepEqual(
    checksums(f, "APP_IPHONE_67"),
    media.APP_IPHONE_67.map((file) => file.md5),
  );
  assert.ok(
    f.writes.some(
      (w) => w.path === "appScreenshots/existing-0" && w.method === "DELETE",
    ),
  );
});

test("screenshot processing failures and timeouts stop before submission", async () => {
  const failed = fixture();
  failed.processResult = "FAILED";
  await assert.rejects(
    failed.run({ commit: true, media, mediaOptions: mediaOptions(failed) }),
    /could not process a store screenshot/,
  );
  assertNoSubmission(failed);

  const slow = fixture();
  slow.holdProcessing = true;
  await assert.rejects(
    slow.run({ commit: true, media, mediaOptions: mediaOptions(slow) }),
    /Timed out waiting for Apple to process store screenshots/,
  );
  assertNoSubmission(slow);
  // A rerun keeps the uploads that are still processing.
  slow.holdProcessing = false;
  const uploads = slow.uploads.length;
  assert.equal(
    (await slow.run({ commit: true, media, mediaOptions: mediaOptions(slow) }))
      .state,
    "WAITING_FOR_REVIEW",
  );
  assert.equal(slow.uploads.length, uploads);
});

test("screenshots that do not read back block submission", async () => {
  const f = fixture();
  const options = mediaOptions(f);
  await f.run({ commit: true, media, mediaOptions: options });
  // A later run finds a screenshot changed outside the publisher while the
  // version is already waiting for review.
  f.shots["set-APP_IPHONE_67"][0].attributes.sourceFileChecksum = "changed";
  f.versions.find((v) => v.id === "new").attributes.appStoreState =
    "READY_FOR_REVIEW";
  f.submissions.length = 0;
  f.items.length = 0;
  await assert.rejects(
    f.run({ commit: true, media, mediaOptions: options }),
    /does not match the requested submission/,
  );
});
