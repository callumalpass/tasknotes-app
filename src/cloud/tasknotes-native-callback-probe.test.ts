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
          manifest,
        },
        { signIn: { open: () => {}, returnUrl } },
      ),
  ).not.toThrow();
});
