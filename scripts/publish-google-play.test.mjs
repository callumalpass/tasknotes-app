import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PLAY_PACKAGE,
  PLAY_RELEASE_STATUS,
  PLAY_TRACK,
  parseServiceAccount,
  publishProduction,
  releaseNotesFor,
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
    if (
      requestUrl.endsWith(":validate") ||
      requestUrl.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW")
    ) {
      return jsonResponse({ id: "edit-1" });
    }
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  });
}

describe("Google Play production publisher", () => {
  it("publishes only a completed production release and commits after validation", async () => {
    const calls = [];
    const fetchImpl = successfulFetch(calls);

    await expect(
      publishProduction({
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
      track: "production",
      versionCode: 123401,
      alreadyPublished: false,
    });

    const trackCall = calls.find((call) =>
      call.url.endsWith("/tracks/production"),
    );
    expect(JSON.parse(trackCall.options.body)).toEqual({
      track: "production",
      releases: [
        {
          name: "TaskNotes 1.2.3",
          versionCodes: ["123401"],
          status: "completed",
          releaseNotes: [{ language: "en-US", text: "TaskNotes 1.2.3." }],
        },
      ],
    });
    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/tracks\/production$/),
        expect.stringMatching(/:validate$/),
        expect.stringMatching(
          /:commit\?changesInReviewBehavior=ERROR_IF_IN_REVIEW$/,
        ),
      ]),
    );
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(false);
    expect(
      JSON.parse(trackCall.options.body).releases[0].userFraction,
    ).toBeUndefined();
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
      publishProduction({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      }),
    ).rejects.toThrow("did not match expected 123401");

    expect(
      calls.some((call) =>
        call.url.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),
      ),
    ).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("treats the exact existing production state as an idempotent success", async () => {
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
      publishProduction({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(),
      }),
    ).resolves.toMatchObject({ alreadyPublished: true, versionCode: 123401 });

    expect(calls.some((call) => call.url.includes("/bundles"))).toBe(false);
    expect(
      calls.some((call) =>
        call.url.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),
      ),
    ).toBe(false);
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
      publishProduction({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      }),
    ).rejects.toThrow("required production release state");
    expect(
      calls.some((call) =>
        call.url.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),
      ),
    ).toBe(false);
  });

  it("rejects malformed credentials and non-TaskNotes release names", async () => {
    expect(() => parseServiceAccount("not-json")).toThrow(
      "not valid base64 JSON",
    );
    await expect(
      publishProduction({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 1,
        name: "Production 1.2.3",
        fetchImpl: vi.fn(),
        readFileImpl: vi.fn(),
      }),
    ).rejects.toThrow("Release name must be");
  });

  it("updates only changed listing languages in the release edit and keeps their video", async () => {
    const calls = [];
    const base = successfulFetch(calls);
    const saved = {};
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/edits/edit-1/listings")) {
        calls.push({ url: requestUrl, options });
        return jsonResponse({
          listings: [
            {
              language: "en-US",
              title: "Old",
              shortDescription: "Old short",
              fullDescription: "Old full",
              video: "https://youtu.be/example",
            },
            {
              language: "fr-FR",
              title: "Titre",
              shortDescription: "Court",
              fullDescription: "Complet",
            },
            { language: "de-DE", title: "Alt" },
          ],
        });
      }
      const listingPath = /\/edits\/edit-1\/listings\/([^/]+)$/.exec(
        requestUrl,
      );
      if (listingPath) {
        calls.push({ url: requestUrl, options });
        saved[decodeURIComponent(listingPath[1])] = JSON.parse(options.body);
        return jsonResponse(JSON.parse(options.body));
      }
      return base(url, options);
    });
    const listing = {
      "en-US": {
        title: "TaskNotes: Markdown To-Do List",
        shortDescription: "Short",
        fullDescription: "Full",
        whatsNew: "Recent improvements.",
      },
      "fr-FR": {
        title: "Titre",
        shortDescription: "Court",
        fullDescription: "Complet",
      },
      "es-419": {
        title: "Tareas",
        shortDescription: "Corto",
        fullDescription: "Completo",
      },
    };

    await publishProduction({
      credentialBase64,
      aabPath: "release.aab",
      expectedVersionCode: 123401,
      name: "TaskNotes 1.2.3",
      listing,
      fetchImpl,
      readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      now: 1_750_000_000_000,
    });

    expect(Object.keys(saved).sort()).toEqual(["en-US", "es-419"]);
    expect(saved["en-US"]).toEqual({
      language: "en-US",
      title: "TaskNotes: Markdown To-Do List",
      shortDescription: "Short",
      fullDescription: "Full",
      video: "https://youtu.be/example",
    });
    expect(calls.some((call) => call.url.includes("/listings/de-DE"))).toBe(
      false,
    );
    const trackCall = calls.find((call) =>
      call.url.endsWith("/tracks/production"),
    );
    expect(JSON.parse(trackCall.options.body).releases[0].releaseNotes).toEqual(
      [
        { language: "en-US", text: "Recent improvements." },
        { language: "fr-FR", text: "TaskNotes 1.2.3." },
        { language: "es-419", text: "TaskNotes 1.2.3." },
      ],
    );
    const order = calls.map((call) => call.url);
    expect(order.findIndex((u) => u.includes("/listings/"))).toBeLessThan(
      order.findIndex((u) =>
        u.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),
      ),
    );
  });

  it("never commits when Play does not save the requested listing", async () => {
    const calls = [];
    const base = successfulFetch(calls);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/edits/edit-1/listings"))
        return jsonResponse({ listings: [] });
      if (/\/listings\/en-US$/.test(requestUrl))
        return jsonResponse({ language: "en-US", title: "Truncated" });
      return base(url, options);
    });
    await expect(
      publishProduction({
        credentialBase64,
        aabPath: "release.aab",
        expectedVersionCode: 123401,
        name: "TaskNotes 1.2.3",
        listing: {
          "en-US": { title: "T", shortDescription: "S", fullDescription: "F" },
        },
        fetchImpl,
        readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      }),
    ).rejects.toThrow("did not save the requested store listing");
    expect(calls.some((call) => call.url.includes(":commit"))).toBe(false);
    expect(calls.some((call) => call.options.method === "DELETE")).toBe(true);
  });

  it("rolling notes already in the live release fall back to the release name", () => {
    const listing = {
      "en-US": { whatsNew: "Recent improvements." },
      "fr-FR": { whatsNew: "Améliorations récentes." },
    };
    expect(
      releaseNotesFor("TaskNotes 1.2.4", listing, [
        { language: "en-US", text: "Recent improvements.\n" },
        { language: "fr-FR", text: "Anciennes notes." },
      ]),
    ).toEqual([
      { language: "en-US", text: "TaskNotes 1.2.4." },
      { language: "fr-FR", text: "Améliorations récentes." },
    ]);
  });

  it("release notes always include the en-US default", () => {
    expect(releaseNotesFor("TaskNotes 1.2.3")).toEqual([
      { language: "en-US", text: "TaskNotes 1.2.3." },
    ]);
    expect(
      releaseNotesFor("TaskNotes 1.2.3", {
        "ja-JP": { whatsNew: "最近の改善。" },
      }),
    ).toEqual([
      { language: "en-US", text: "TaskNotes 1.2.3." },
      { language: "ja-JP", text: "最近の改善。" },
    ]);
  });
  const image = (name) => {
    const bytes = Buffer.from(`fake ${name}`);
    return {
      fileName: `${name}.png`,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  const media = {
    phoneScreenshots: [image("phone-1"), image("phone-2")],
    featureGraphic: [image("feature")],
  };
  function mediaFetch(calls, { stored = {}, saveAs } = {}) {
    const base = successfulFetch(calls);
    return vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/edits/edit-1/details")) {
        calls.push({ url: requestUrl, options });
        return jsonResponse({ defaultLanguage: "en-US" });
      }
      const images =
        /\/edits\/edit-1\/listings\/en-US\/(\w+)(\?uploadType=media)?$/.exec(
          requestUrl,
        );
      if (images) {
        calls.push({ url: requestUrl, options });
        const [, type, upload] = images;
        if (upload) {
          expect(requestUrl).toContain("/upload/androidpublisher/v3/");
          const sha256 =
            saveAs ?? createHash("sha256").update(options.body).digest("hex");
          (stored[type] ??= []).push({ sha256 });
          return jsonResponse({ image: { sha256 } });
        }
        if (options.method === "DELETE") {
          stored[type] = [];
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ images: stored[type] ?? [] });
      }
      return base(url, options);
    });
  }
  const publishWithMedia = (fetchImpl) =>
    publishProduction({
      credentialBase64,
      aabPath: "release.aab",
      expectedVersionCode: 123401,
      name: "TaskNotes 1.2.3",
      media,
      fetchImpl,
      readFileImpl: vi.fn(async () => Buffer.from("bundle")),
      now: 1_750_000_000_000,
    });

  it("replaces only changed store images of the default language in the release edit", async () => {
    const calls = [];
    const stored = {
      phoneScreenshots: [{ sha256: "stale" }],
      featureGraphic: [{ sha256: media.featureGraphic[0].sha256 }],
    };
    await publishWithMedia(mediaFetch(calls, { stored }));

    expect(stored.phoneScreenshots).toEqual(
      media.phoneScreenshots.map(({ sha256 }) => ({ sha256 })),
    );
    const order = calls.map(
      (call) => `${call.options.method ?? "GET"} ${call.url}`,
    );
    expect(
      order.filter(
        (call) => call.includes("/featureGraphic") && !call.startsWith("GET"),
      ),
    ).toEqual([]);
    const deleted = order.findIndex(
      (call) => call.startsWith("DELETE") && call.endsWith("/phoneScreenshots"),
    );
    const uploads = order
      .map((call, index) =>
        call.includes("uploadType=media") && call.includes("/listings/")
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    expect(uploads).toHaveLength(2);
    expect(deleted).toBeLessThan(uploads[0]);
    expect(uploads.at(-1)).toBeLessThan(
      order.findIndex((call) =>
        call.endsWith(":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),
      ),
    );
    const upload = calls.find((call) =>
      call.url.includes("/phoneScreenshots?"),
    );
    expect(upload.options.headers.get("content-type")).toBe("image/png");
  });

  it("leaves unchanged store images alone", async () => {
    const calls = [];
    const stored = Object.fromEntries(
      Object.entries(media).map(([type, files]) => [
        type,
        files.map(({ sha256 }) => ({ sha256 })),
      ]),
    );
    await publishWithMedia(mediaFetch(calls, { stored }));
    expect(
      calls.some(
        (call) =>
          call.url.includes("/listings/en-US/") &&
          (call.options.method ?? "GET") !== "GET",
      ),
    ).toBe(false);
  });

  it("never commits when Play does not save the requested store image", async () => {
    const calls = [];
    await expect(
      publishWithMedia(mediaFetch(calls, { saveAs: "different" })),
    ).rejects.toThrow("did not save the requested store image");
    expect(calls.some((call) => call.url.includes(":commit"))).toBe(false);
  });
});
