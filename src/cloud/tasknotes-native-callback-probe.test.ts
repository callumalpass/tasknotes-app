import { expect, it } from "vitest";
import { MdbaseConnect } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";

it("accepts the original declared TaskNotes native return URL", () => {
  const returnUrl = "dev.tasknotes.app://auth/mdbase/callback";
  expect(manifest.redirect_uris).toContain(returnUrl);
  // Construction is IO-free; no Worker, browser, account or registration.
  expect(
    () =>
      new MdbaseConnect(
        {
          id: "5cdfa020-c201-4da8-845a-f2cc9969eade",
          name: "TaskNotes",
          origin: "https://app.tasknotes.dev",
          environment: "production",
          // dev:e2e rewrites the generated URLs. Use explicit production
          // fixture origins without changing the generated release input.
          manifest: {
            ...manifest,
            homepage: "https://app.tasknotes.dev/",
            icon: "https://app.tasknotes.dev/icon.png",
            redirect_uris: [
              "https://app.tasknotes.dev/auth/mdbase/callback",
              returnUrl,
            ],
          },
        },
        { signIn: { open: () => {}, returnUrl } },
      ),
  ).not.toThrow();
});
