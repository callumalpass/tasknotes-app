import { CollectionSwitcher } from "@mdbase-dev/ui/collections";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { afterEach, expect, it, vi } from "vitest";

import { fireEvent, render, screen, within } from "../test/render";
import { SelfHostedEntry } from "./self-hosted-entry";

afterEach(() => vi.unstubAllGlobals());

async function openSignedOutSwitcher() {
  const mdbase = await createTestMdbase({ phase: "signed_out" });
  render(
    <CollectionSwitcher
      mdbase={mdbase}
      app={{ name: "TaskNotes" }}
      signedOutExtra={<SelfHostedEntry />}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Choose a collection/ }));
  return screen.findByRole("dialog", { name: "Collections" });
}

it("offers the self-hosted site under Sign in in the signed-out collections dialog", async () => {
  vi.stubGlobal("__SELF_HOSTED_UI_ORIGIN__", "https://ui.example");
  const dialog = await openSignedOutSwitcher();
  const signIn = within(dialog).getByRole("button", { name: "Sign in" });
  const link = within(dialog).getByRole("link", {
    name: "Connect to your own server",
  });
  expect(link).toHaveAttribute("href", "https://ui.example");
  expect(link).toHaveAttribute("rel", "noreferrer");
  expect(
    signIn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it.each([null, location.origin])(
  "shows nothing when the self-hosted origin is %s",
  async (origin) => {
    vi.stubGlobal("__SELF_HOSTED_UI_ORIGIN__", origin);
    const dialog = await openSignedOutSwitcher();
    expect(
      within(dialog).getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(within(dialog).queryByRole("link")).toBeNull();
  },
);
