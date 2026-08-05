import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { operationsForApplicationCapabilities } from "@mdbase-dev/connect";
import { connectSuccess } from "@mdbase-dev/connect-testing";

import bundledManifest from "../generated/mdbase-app.json";
import { cloudConnect, cloudSession } from "./connect";

const expectedOperations = operationsForApplicationCapabilities(
  bundledManifest.requirements.capabilities as never,
);
let registrationRequestBody: unknown;

describe("TaskNotes mdbase session", () => {
  beforeAll(async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (!String(input).endsWith("/v1/apps/register")) {
          throw new Error(
            `Unexpected TaskNotes session request: ${String(input)}`,
          );
        }
        registrationRequestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            application: {
              id: "00000000-0000-0000-0000-000000000001",
              family_identity: "bundle:dev.tasknotes.app",
              manifest_digest: "a".repeat(64),
              name: "TaskNotes",
              homepage: "https://app.tasknotes.dev/",
              requirements: bundledManifest.requirements,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });
    const started = await cloudSession.start();
    fetch.mockRestore();
    if (!started.ok) throw new Error(started.problem.message);
  });

  afterAll(() => cloudSession.destroy());

  afterEach(() => {
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("registers the generated declaration inline", () => {
    expect(registrationRequestBody).toEqual({
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
