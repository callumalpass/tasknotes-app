import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PLAY_PACKAGE,
  PLAY_PRODUCTION_RELEASE_STATUS,
  PLAY_PRODUCTION_TRACK,
  PLAY_RELEASE_STATUS,
  PLAY_TRACK,
  parseServiceAccount,
  promoteToProduction,
  publishClosedTest,
} from "./publish-google-play.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential = {
  type: "service_account",
  client_email: "publisher@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
};
const credentialBase64 = Buffer.from(JSON.stringify(credential)).toString(
  "base64",
);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successfulFetch(calls) {
  return vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const requestUrl = String(url);
    if (requestUrl === credential.token_uri) {
      return jsonResponse({ access_token: "short-lived-token" });
    }
    if (requestUrl.endsWith(`/applications/${PLAY_PACKAGE}/edits`)) {
      return jsonResponse({ id: "edit-1" });
    }
    if (requestUrl.endsWith("/tracks")) {
      return jsonResponse({
        tracks: [
          {
            track: PLAY_TRACK,
            releases: [
              {
                name: "TaskNotes 1.2.2",
                status: PLAY_RELEASE_STATUS,
                versionCodes: ["123400"],
              },
            ],
          },
        ],
      });
    }
    if (requestUrl.includes("/bundles?uploadType=media")) {
      return jsonResponse({ versionCode: 123401 });
    }
    if (requestUrl.endsWith(`/tracks/${PLAY_TRACK}`)) {
      return jsonResponse({
        track: PLAY_TRACK,
        releases: [
          {
            name: "TaskNotes 1.2.3",
            status: PLAY_RELEASE_STATUS,
            versionCodes: ["123401"],
          },
        ],
      });
    }
    if (requestUrl.endsWith(":validate") || requestUrl.endsWith(":commit")) {
      return jsonResponse({ id: "edit-1" });
    }
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  });
}

describe("Google Play closed-test publisher", () => {
  it("publishes only a completed alpha release and commits after validation", async () => {
    const calls = [];
    const fetchImpl = successfulFetch(calls);

    await expect(
      publishClosedTest({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
        now: 1_750_000_000_000,
      }),
    ).resolves.toEqual({
      packageName: PLAY_PACKAGE,
      track: "alpha",
      versionCode: 123401,
      alreadyPublished: false,
    });

    const trackCall = calls.find((call) => call.url.endsWith("/tracks/alpha"));
    expect(JSON.parse(trackCall.options.body)).toEqual({
      track: "alpha",
      releases: [
        {
          name: "TaskNotes 1.2.3",
          versionCodes: ["123401"],
          status: "completed",
        },
      ],
    });
    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/tracks\/alpha$/),
        expect.stringMatching(/:validate$/),
        expect.stringMatching(/:commit$/),
      ]),
    );
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(false);
    expect(calls.some((call) => call.url.includes("production"))).toBe(false);
  });

  it("abandons the edit and never commits when the uploaded version differs", async () => {
    const calls = [];
    const fetchImpl = successfulFetch(calls);
    fetchImpl.mockImplementation(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const requestUrl = String(url);
      if (requestUrl === credential.token_uri) {
        return jsonResponse({ access_token: "short-lived-token" });
      }
      if (requestUrl.endsWith(`/applications/${PLAY_PACKAGE}/edits`)) {
        return jsonResponse({ id: "edit-2" });
      }
      if (requestUrl.endsWith("/tracks")) {
        return jsonResponse({ tracks: [] });
      }
      if (requestUrl.includes("/bundles?uploadType=media")) {
        return jsonResponse({ versionCode: 999 });
      }
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    await expect(
      publishClosedTest({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      }),
    ).rejects.toThrow("did not match expected 123401");

    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("treats the exact existing closed-test state as an idempotent success", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const requestUrl = String(url);
      if (requestUrl === credential.token_uri) {
        return jsonResponse({ access_token: "short-lived-token" });
      }
      if (requestUrl.endsWith(`/applications/${PLAY_PACKAGE}/edits`)) {
        return jsonResponse({ id: "edit-existing" });
      }
      if (requestUrl.endsWith("/tracks")) {
        return jsonResponse({
          tracks: [
            {
              track: PLAY_TRACK,
              releases: [
                {
                  name: "TaskNotes 1.2.3",
                  status: PLAY_RELEASE_STATUS,
                  versionCodes: ["123401"],
                },
              ],
            },
          ],
        });
      }
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    await expect(
      publishClosedTest({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(),
      }),
    ).resolves.toMatchObject({ alreadyPublished: true, versionCode: 123401 });

    expect(calls.some((call) => call.url.includes("/bundles"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("rejects an inexact API track response before committing", async () => {
    const calls = [];
    const fetchImpl = successfulFetch(calls);
    fetchImpl.mockImplementation(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const requestUrl = String(url);
      if (requestUrl === credential.token_uri) {
        return jsonResponse({ access_token: "short-lived-token" });
      }
      if (requestUrl.endsWith(`/applications/${PLAY_PACKAGE}/edits`)) {
        return jsonResponse({ id: "edit-inexact" });
      }
      if (requestUrl.endsWith("/tracks")) return jsonResponse({ tracks: [] });
      if (requestUrl.includes("/bundles?uploadType=media")) {
        return jsonResponse({ versionCode: 123401 });
      }
      if (requestUrl.endsWith(`/tracks/${PLAY_TRACK}`)) {
        return jsonResponse({
          track: PLAY_TRACK,
          releases: [
            {
              name: "TaskNotes 1.2.3",
              status: PLAY_RELEASE_STATUS,
              versionCodes: ["123401", "123402"],
            },
          ],
        });
      }
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    await expect(
      publishClosedTest({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      }),
    ).rejects.toThrow("required closed-test release state");
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
  });

  it("rejects malformed credentials and non-TaskNotes release names", async () => {
    expect(() => parseServiceAccount("not-json")).toThrow(
      "not valid base64 JSON",
    );
    await expect(
      publishClosedTest({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 1,
        name: "Production 1.2.3",
        fetchImpl: vi.fn(),
        readFileImpl: vi.fn(),
      }),
    ).rejects.toThrow("Release name must be");
  });
});

const alphaRelease = {
  name: "TaskNotes 1.2.3",
  status: "completed",
  versionCodes: ["123401"],
  releaseNotes: [{ language: "en-US", text: "Closed-test notes" }],
};

function promotionFetch(calls, { tracks, putResponse } = {}) {
  return vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const requestUrl = String(url);
    if (requestUrl === credential.token_uri) {
      return jsonResponse({ access_token: "short-lived-token" });
    }
    if (requestUrl.endsWith(`/applications/${PLAY_PACKAGE}/edits`)) {
      return jsonResponse({ id: "edit-production" });
    }
    if (requestUrl.endsWith("/tracks")) {
      return jsonResponse({
        tracks: tracks ?? [
          { track: "alpha", releases: [alphaRelease] },
          { track: "production", releases: [] },
        ],
      });
    }
    if (requestUrl.endsWith("/tracks/production")) {
      return jsonResponse(putResponse ?? JSON.parse(options.body));
    }
    if (requestUrl.endsWith(":validate") || requestUrl.endsWith(":commit")) {
      return jsonResponse({ id: "edit-production" });
    }
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  });
}

function promote(fetchImpl, overrides = {}) {
  return promoteToProduction({
    credentialBase64,
    expectedVersionCode: 123401,
    name: "TaskNotes 1.2.3",
    fetchImpl,
    now: 1_750_000_000_000,
    ...overrides,
  });
}

describe("Google Play production promotion", () => {
  it("fixes the production policy in code", () => {
    expect(PLAY_PRODUCTION_TRACK).toBe("production");
    expect(PLAY_PRODUCTION_RELEASE_STATUS).toBe("completed");
  });

  it("promotes the closed-test version to a completed production release without uploading", async () => {
    const calls = [];
    const fetchImpl = promotionFetch(calls);

    await expect(promote(fetchImpl)).resolves.toEqual({
      packageName: PLAY_PACKAGE,
      track: "production",
      versionCode: 123401,
      alreadyPublished: false,
    });

    const trackCall = calls.find((call) =>
      call.url.endsWith("/tracks/production"),
    );
    expect(trackCall.options.method).toBe("PUT");
    expect(JSON.parse(trackCall.options.body)).toEqual({
      track: "production",
      releases: [
        {
          name: "TaskNotes 1.2.3",
          versionCodes: ["123401"],
          status: "completed",
          releaseNotes: [{ language: "en-US", text: "Closed-test notes" }],
        },
      ],
    });
    const urls = calls.map((call) => call.url);
    expect(urls.findIndex((url) => url.endsWith(":validate"))).toBeLessThan(
      urls.findIndex((url) => url.endsWith(":commit")),
    );
    expect(urls.some((url) => url.includes("/bundles"))).toBe(false);
    expect(urls.some((url) => url.endsWith("/tracks/alpha"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(false);
  });

  it("supersedes an older completed production release", async () => {
    const calls = [];
    const fetchImpl = promotionFetch(calls, {
      tracks: [
        { track: "alpha", releases: [alphaRelease] },
        {
          track: "production",
          releases: [
            {
              name: "TaskNotes 1.2.2",
              status: "completed",
              versionCodes: ["123400"],
            },
          ],
        },
      ],
    });

    await expect(promote(fetchImpl)).resolves.toMatchObject({
      alreadyPublished: false,
    });
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(true);
  });

  it("treats the exact existing production state as a read-only success", async () => {
    const calls = [];
    const fetchImpl = promotionFetch(calls, {
      tracks: [
        { track: "alpha", releases: [] },
        {
          track: "production",
          releases: [
            {
              name: "TaskNotes 1.2.3",
              status: "completed",
              versionCodes: ["123401"],
            },
          ],
        },
      ],
    });

    await expect(promote(fetchImpl)).resolves.toMatchObject({
      alreadyPublished: true,
      track: "production",
      versionCode: 123401,
    });
    expect(calls.some((call) => call.options.method === "PUT")).toBe(false);
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it.each([
    ["missing from alpha", [{ ...alphaRelease, versionCodes: ["123400"] }]],
    ["not completed on alpha", [{ ...alphaRelease, status: "draft" }]],
    [
      "named differently on alpha",
      [{ ...alphaRelease, name: "TaskNotes 9.9.9" }],
    ],
  ])("refuses a version code %s", async (_label, releases) => {
    const calls = [];
    const fetchImpl = promotionFetch(calls, {
      tracks: [
        { track: "alpha", releases },
        { track: "production", releases: [] },
      ],
    });

    await expect(promote(fetchImpl)).rejects.toThrow(/closed-test/);
    expect(calls.some((call) => call.options.method === "PUT")).toBe(false);
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it.each([
    [
      "a higher completed release",
      [
        {
          name: "TaskNotes 1.2.4",
          status: "completed",
          versionCodes: ["123402"],
        },
      ],
      "or a higher release",
    ],
    [
      "the same version in a staged rollout",
      [
        {
          name: "TaskNotes 1.2.3",
          status: "inProgress",
          userFraction: 0.1,
          versionCodes: ["123401"],
        },
      ],
      "inProgress release",
    ],
    [
      "an older halted release",
      [{ name: "TaskNotes 1.2.2", status: "halted", versionCodes: ["123400"] }],
      "halted release",
    ],
    [
      "the same version under another name",
      [
        {
          name: "TaskNotes 1.2.9",
          status: "completed",
          versionCodes: ["123401"],
        },
      ],
      "or a higher release",
    ],
  ])(
    "refuses when production already has %s",
    async (_label, releases, message) => {
      const calls = [];
      const fetchImpl = promotionFetch(calls, {
        tracks: [
          { track: "alpha", releases: [alphaRelease] },
          { track: "production", releases },
        ],
      });

      await expect(promote(fetchImpl)).rejects.toThrow(message);
      expect(calls.some((call) => call.options.method === "PUT")).toBe(false);
      expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    },
  );

  it("rejects an inexact production track response before committing", async () => {
    const calls = [];
    const fetchImpl = promotionFetch(calls, {
      putResponse: {
        track: "production",
        releases: [
          {
            name: "TaskNotes 1.2.3",
            status: "inProgress",
            userFraction: 0.2,
            versionCodes: ["123401"],
          },
        ],
      },
    });

    await expect(promote(fetchImpl)).rejects.toThrow(
      "required production release state",
    );
    expect(calls.some((call) => call.url.endsWith(":validate"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("does not commit when Play rejects validation", async () => {
    const calls = [];
    const base = promotionFetch(calls);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith(":validate")) {
        calls.push({ url: String(url), options });
        return jsonResponse({ error: { message: "Invalid edit" } }, 400);
      }
      return base(url, options);
    });

    await expect(promote(fetchImpl)).rejects.toThrow("Invalid edit (HTTP 400)");
    expect(calls.some((call) => call.url.endsWith(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("rejects invalid version codes and release names before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      promote(fetchImpl, { expectedVersionCode: "0" }),
    ).rejects.toThrow("Expected Android version code");
    await expect(
      promote(fetchImpl, { name: "Production 1.2.3" }),
    ).rejects.toThrow("Release name must be");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
