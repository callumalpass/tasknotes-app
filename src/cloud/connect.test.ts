import { afterEach, describe, expect, it, vi } from "vitest";

import bundledManifest from "../generated/mdbase-app.json";
import {
  authorizeCloudCollection,
  cloudConnect,
  savedCloudConnections,
} from "./connect";

const STORAGE_PREFIX =
  "mdbase-connect:https://connect.mdbase.dev:bundle:dev.tasknotes.app";

describe("TaskNotes mdbase connection", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("registers the generated declaration inline", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          application: {
            id: "00000000-0000-0000-0000-000000000001",
            name: "TaskNotes",
            homepage: "https://app.tasknotes.dev/",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await cloudConnect.register();

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      manifest: bundledManifest,
    });
  });

  it("retains independently authorized collections", () => {
    const collectionIds = ["collection-home", "collection-work"];
    localStorage.setItem(
      `${STORAGE_PREFIX}:connections`,
      JSON.stringify(collectionIds),
    );
    localStorage.setItem(
      `${STORAGE_PREFIX}:token:${collectionIds[0]}`,
      JSON.stringify(token(collectionIds[0], "Home tasks")),
    );
    localStorage.setItem(
      `${STORAGE_PREFIX}:token:${collectionIds[1]}`,
      JSON.stringify(token(collectionIds[1], "Work tasks")),
    );

    expect(
      savedCloudConnections().map(({ collectionId, displayName }) => ({
        collectionId,
        displayName,
      })),
    ).toEqual([
      { collectionId: "collection-home", displayName: "Home tasks" },
      { collectionId: "collection-work", displayName: "Work tasks" },
    ]);
  });

  it("does not pin the current collection when authorizing another one", () => {
    const authorize = vi
      .spyOn(cloudConnect, "authorize")
      .mockResolvedValue({} as never);

    void authorizeCloudCollection();

    expect(authorize).toHaveBeenCalledWith(
      expect.not.objectContaining({ collectionId: expect.anything() }),
    );
  });
});

function token(collectionId: string, collectionName: string) {
  return {
    accessToken: `access-${collectionId}`,
    refreshToken: `refresh-${collectionId}`,
    clientId: "tasknotes",
    collectionId,
    collectionName,
    operations: ["describe", "read", "query"],
    scope: {
      contracts: [
        {
          id: "tasknotes.task",
          version: "0.2.0",
          digest: `sha256:${"0".repeat(64)}`,
          schema: {},
          implementations: [
            {
              type_name: "task",
              type_version: 1,
              digest: `sha256:${"1".repeat(64)}`,
              fields: { title: "title" },
            },
          ],
        },
      ],
      access: "full_collection",
    },
    expiresAt: Date.now() + 60_000,
    refreshExpiresAt: Date.now() + 120_000,
    savedAt: Date.now(),
  };
}
