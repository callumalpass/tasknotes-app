import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { APP_ID, BUNDLE_ID } from "./submit-app-store.mjs";
import {
  createStatusClient,
  readAppStoreStatus,
  statusSummary,
} from "./app-store-status.mjs";

// Newer than the stale package.json version, as store CD numbers releases.
const VERSION = "1.0.31";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = { privateKey, keyId: "TESTKEY", issuerId: "test-issuer" };
const secret = "synthetic-private-review-information";
const item = (id) => ({
  relationships: {
    appStoreVersion: { data: { type: "appStoreVersions", id } },
  },
});
function fixture() {
  const f = {
    requests: [],
    bundleId: BUNDLE_ID,
    versions: [
      {
        id: "old",
        attributes: {
          versionString: "1.0.30",
          appStoreState: "READY_FOR_SALE",
        },
      },
      {
        id: "older",
        attributes: {
          versionString: "1.0.12",
          appStoreState: "REPLACED_WITH_NEW_VERSION",
        },
      },
      {
        id: "target",
        attributes: {
          versionString: VERSION,
          appStoreState: "WAITING_FOR_REVIEW",
          releaseType: "MANUAL",
          demoAccountName: secret,
          demoAccountPassword: secret,
        },
      },
    ],
    submissions: [
      { id: "complete", attributes: { state: "COMPLETE" } },
      { id: "review", attributes: { state: "WAITING_FOR_REVIEW" } },
      { id: "other", attributes: { state: "IN_REVIEW" } },
    ],
    items: { review: [item("target")], other: [item("old")] },
    builds: [{ attributes: { version: "27", processingState: "VALID" } }],
    attached: { attributes: { version: "26", processingState: "VALID" } },
  };
  f.client = createStatusClient(credentials, {
    fetchImpl: async (url, init) => {
      assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      f.requests.push(url);
      let data;
      let next;
      if (url.pathname === `/v1/apps/${APP_ID}`)
        data = { attributes: { bundleId: f.bundleId, contactEmail: secret } };
      else if (url.pathname === `/v1/apps/${APP_ID}/appStoreVersions`) {
        if (f.paginate && !url.searchParams.has("cursor")) {
          data = [f.versions[0]];
          next = `${url.href}&cursor=next`;
        } else data = f.paginate ? f.versions.slice(1) : f.versions;
      } else if (url.pathname === "/v1/reviewSubmissions") data = f.submissions;
      else if (url.pathname === "/v1/appStoreVersions/target/build")
        data = f.attached;
      else if (/^\/v1\/reviewSubmissions\/[^/]+\/items$/.test(url.pathname))
        data = f.items[url.pathname.split("/")[3]];
      else if (url.pathname === "/v1/builds") {
        data = f.builds;
        // Latest-build lookup must not follow a second page of older builds.
        next = "https://api.appstoreconnect.apple.com/v1/builds?older=1";
        assert.equal(url.searchParams.get("filter[app]"), APP_ID);
        assert.equal(
          url.searchParams.get("filter[preReleaseVersion.version]"),
          VERSION,
        );
        assert.equal(
          url.searchParams.get("filter[preReleaseVersion.platform]"),
          "IOS",
        );
        assert.equal(url.searchParams.get("sort"), "-uploadedDate");
        assert.equal(url.searchParams.get("limit"), "1");
        assert.ok(!url.searchParams.has("older"));
      } else throw new Error("Unexpected fixture endpoint");
      return new Response(JSON.stringify({ data, links: { next } }), {
        status: 200,
      });
    },
  });
  f.run = () => readAppStoreStatus(f.client);
  return f;
}

test("GET-only status reads the requested version, its active review and latest build without private data", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, {
    version: VERSION,
    liveVersion: "1.0.30",
    appStoreState: "WAITING_FOR_REVIEW",
    releaseType: "MANUAL",
    reviewSubmissionState: "WAITING_FOR_REVIEW",
    attachedBuild: { buildNumber: "26", processingState: "VALID" },
    latestBuild: { buildNumber: "27", processingState: "VALID" },
  });
  assert.match(
    statusSummary(result),
    new RegExp(
      `^${VERSION.replaceAll(".", "\\.")}: WAITING_FOR_REVIEW \\(MANUAL\\)`,
    ),
  );
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!statusSummary(result).includes(secret));
  assert.equal(f.client.request, undefined);
  assert.equal(f.client.post, undefined);
  assert.equal(f.client.patch, undefined);
  assert.equal(
    f.requests.filter((url) => url.pathname === "/v1/builds").length,
    1,
  );
  assert.ok(
    !f.requests.some((url) => url.pathname.includes("/complete/items")),
  );
  for (const url of f.requests) {
    assert.ok(!url.href.includes("demoAccount"));
    assert.ok(!url.href.includes("contact"));
  }
});

test("approved MANUAL version reports PENDING_DEVELOPER_RELEASE and no active review after completion", async () => {
  const f = fixture();
  f.versions[2].attributes.appStoreState = "PENDING_DEVELOPER_RELEASE";
  f.submissions[1].attributes.state = "COMPLETE";
  const result = await f.run();
  assert.equal(result.reviewSubmissionState, "NONE");
  assert.match(
    statusSummary(result),
    new RegExp(
      `^${VERSION.replaceAll(".", "\\.")}: PENDING_DEVELOPER_RELEASE \\(MANUAL\\)`,
    ),
  );
});

test("follows GET-only version pagination but not older-build pagination", async () => {
  const f = fixture();
  f.paginate = true;
  assert.equal((await f.run()).appStoreState, "WAITING_FOR_REVIEW");
  assert.ok(f.requests.some((url) => url.searchParams.has("cursor")));
});

test("reports missing version/build without manufacturing a review state", async () => {
  const f = fixture();
  f.versions = [];
  f.builds = [];
  assert.deepEqual(await f.run(), {
    version: "NOT_FOUND",
    liveVersion: "NONE",
    appStoreState: "NOT_FOUND",
    releaseType: "NOT_FOUND",
    reviewSubmissionState: "NONE",
    attachedBuild: null,
    latestBuild: null,
  });
});

test("reports the newest version record even when versions arrive out of order", async () => {
  const f = fixture();
  // Apple lists versions in no guaranteed order; a stale record must not win.
  f.versions.reverse();
  f.versions.push({
    id: "ancient",
    attributes: { versionString: "1.0.9", appStoreState: "READY_FOR_SALE" },
  });
  const result = await f.run();
  assert.equal(result.version, VERSION);
  assert.equal(result.liveVersion, "1.0.30");
  assert.equal(result.attachedBuild.buildNumber, "26");
  const builds = f.requests.find((url) => url.pathname === "/v1/builds");
  assert.equal(
    builds.searchParams.get("filter[preReleaseVersion.version]"),
    VERSION,
  );
});

test("reports a draft with no attached build", async () => {
  const f = fixture();
  f.versions[2].attributes.appStoreState = "PREPARE_FOR_SUBMISSION";
  f.attached = null;
  const result = await f.run();
  assert.equal(result.appStoreState, "PREPARE_FOR_SUBMISSION");
  assert.equal(result.attachedBuild, null);
  assert.match(statusSummary(result), /Attached build: NONE/);
});

test("reports PROCESSING without polling or changing the build", async () => {
  const f = fixture();
  f.builds[0].attributes.processingState = "PROCESSING";
  assert.equal((await f.run()).latestBuild.processingState, "PROCESSING");
});

for (const [label, change] of [
  [
    "wrong app",
    (f) => {
      f.bundleId = "wrong.app";
    },
  ],
  [
    "duplicate versions",
    (f) => {
      f.versions.push(f.versions[2]);
    },
  ],
  [
    "duplicate active reviews",
    (f) => {
      f.items.other = [item("target")];
    },
  ],
  [
    "invalid status text",
    (f) => {
      f.versions[2].attributes.appStoreState = secret;
    },
  ],
  [
    "invalid build number",
    (f) => {
      f.builds[0].attributes.version = secret;
    },
  ],
]) {
  test(`refuses ${label} without exposing response data`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(f.run(), (error) => {
      assert.ok(!error.message.includes(secret));
      return true;
    });
  });
}

test("workflow is dispatch-only, main-only, without an environment or write permissions, using the repo upload key", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/app-store-status.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /on:\n {2}workflow_dispatch:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(
    workflow,
    /^\s*(environment|push|pull_request|schedule):/m,
  );
  assert.doesNotMatch(workflow, /: write\b/);
  assert.ok(
    workflow.includes(
      "APP_STORE_CONNECT_ISSUER_ID: ${{ vars.APP_STORE_CONNECT_ISSUER_ID }}",
    ),
  );
  assert.ok(
    workflow.includes(
      "APP_STORE_CONNECT_KEY_ID: ${{ vars.APP_STORE_CONNECT_KEY_ID }}",
    ),
  );
  assert.ok(
    workflow.includes(
      "APP_STORE_CONNECT_PRIVATE_KEY_BASE64: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 }}",
    ),
  );
  assert.ok(!workflow.includes("APP_STORE_PUBLISH"));
  assert.ok(!workflow.includes("APP_REVIEW_DEMO"));
  assert.ok(workflow.includes("run: node scripts/app-store-status.mjs"));
});
