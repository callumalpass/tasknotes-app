import { afterEach, describe, expect, it, vi } from "vitest";

import bundledManifest from "../generated/mdbase-app.json";
import { cloudConnect } from "./connect";

describe("TaskNotes mdbase connection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers the generated declaration inline", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          application: {
            id: "00000000-0000-0000-0000-000000000001",
            name: "TaskNotes",
            homepage: "https://tasknotes.dev/app/",
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
});
