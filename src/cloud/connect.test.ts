import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectSuccess } from "@mdbase-dev/connect";

import bundledManifest from "../generated/mdbase-app.json";
import { operationsForApplicationCapabilities } from "@mdbase-dev/connect-protocol";
import { cloudConnect, cloudSession } from "./connect";

const expectedOperations = operationsForApplicationCapabilities(
  bundledManifest.requirements.capabilities as never,
);

describe("TaskNotes mdbase session", () => {
  beforeAll(async () => {
    await cloudSession.start();
  });

  afterAll(() => cloudSession.destroy());

  afterEach(() => {
    history.replaceState(null, "", "/");
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

  it("authorizes another collection with an explicit choose intent", async () => {
    const authorize = vi
      .spyOn(cloudConnect, "authorize")
      .mockResolvedValue(connectSuccess({ kind: "redirecting" }));

    await cloudSession.authorize("choose");

    expect(authorize).toHaveBeenCalledWith({
      operations: expectedOperations,
      target: { kind: "choose" },
      returnTo: "/",
    });
  });

  it("authorizes an exact newly adopted collection", async () => {
    const authorize = vi
      .spyOn(cloudConnect, "authorize")
      .mockResolvedValue(connectSuccess({ kind: "redirecting" }));

    await cloudSession.authorize({ collectionId: "hosted-after-adoption" });

    expect(authorize).toHaveBeenCalledWith({
      operations: expectedOperations,
      target: {
        kind: "collection",
        collectionId: "hosted-after-adoption",
      },
      returnTo: "/",
    });
  });
});
