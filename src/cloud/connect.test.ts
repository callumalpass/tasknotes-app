import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bundledManifest from "../generated/mdbase-app.json";
import { cloudSession } from "./connect";

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
              provisions: bundledManifest.provisions,
              distribution: "web",
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

  it("registers the generated declaration inline", () => {
    expect(registrationRequestBody).toEqual({
      manifest: bundledManifest,
    });
  });
});
