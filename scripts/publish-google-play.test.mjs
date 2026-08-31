import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PLAY_PACKAGE,
  PLAY_RELEASE_STATUS,
  PLAY_TRACK,
  parseServiceAccount,
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
