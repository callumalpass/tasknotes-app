import { act, fireEvent, render, screen } from "@testing-library/react";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { expect, it, vi } from "vitest";
import { describeError, type MdbaseSnapshot } from "@mdbase-dev/sdk";
import { AccountUpgradeWait } from "./account-upgrade-wait";
import { isAccountUpgradeWait } from "./account-upgrade-state";

it("uses only the SDK migration outcome, never generic fencing or refusal", () => {
  for (const problem of ["fenced", "forbidden", "recovery_required", null]) {
    expect(
      isAccountUpgradeWait({
        problem,
        phase: { kind: "starting" },
      } as MdbaseSnapshot),
    ).toBe(false);
  }
  expect(
    isAccountUpgradeWait({
      problem: "collection_migrating",
      phase: { kind: "starting" },
    } as MdbaseSnapshot),
  ).toBe(true);
});
it("leaves a not-yet-migrated collection to the shared gate's desktop-upgrade copy", () => {
  // This state needs the user to open the desktop app; it never resolves by
  // waiting, so it must not show the self-resolving upgrade screen.
  for (const snapshot of [
    { problem: "collection_not_yet_migrated", phase: { kind: "starting" } },
    {
      problem: null,
      phase: {
        kind: "problem",
        problem: { code: "collection_not_yet_migrated" },
      },
    },
  ])
    expect(isAccountUpgradeWait(snapshot as MdbaseSnapshot)).toBe(false);
  const described = describeError("collection_not_yet_migrated");
  expect(described?.title).toBe("Your collection needs an upgrade");
  expect(described?.message).toMatch(/latest mdbase desktop app/);
  expect(described?.message).not.toMatch(/connection/i);
});
it("offers the SDK's shared copy and a read-only recheck without error codes", async () => {
  const start = vi
    .fn()
    .mockRejectedValueOnce(new Error("secret technical detail"));
  const assess = vi.fn();
  const mdbase = { ...(await createTestMdbase()), start, assess };
  render(<AccountUpgradeWait mdbase={mdbase} />);
  expect(
    screen.getByRole("heading", { name: "Your collection is being upgraded" }),
  ).toBeVisible();
  expect(
    screen.getByText(/Your data is safe. This usually takes a few minutes/),
  ).toBeVisible();
  expect(screen.queryByText(/within a day/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await act(async () => {});
  expect(start).toHaveBeenCalledOnce();
  expect(assess).not.toHaveBeenCalled();
  expect(
    screen.getByText("Still upgrading. TaskNotes will keep checking."),
  ).toBeVisible();
  expect(screen.queryByText(/secret technical detail/)).toBeNull();
});

it("says it is still upgrading when a recheck succeeds but the collection is still fenced", async () => {
  const base = await createTestMdbase();
  const mdbase = {
    ...base,
    start: vi.fn().mockResolvedValue(undefined),
    refreshCollectionList: vi.fn().mockResolvedValue(undefined),
    assess: vi.fn().mockResolvedValue(undefined),
    getSnapshot: () =>
      ({
        problem: "collection_migrating",
        phase: { kind: "starting" },
      }) as MdbaseSnapshot,
  };
  render(<AccountUpgradeWait mdbase={mdbase} />);
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await act(async () => {});
  expect(mdbase.assess).toHaveBeenCalledOnce();
  expect(
    screen.getByText("Still upgrading. TaskNotes will keep checking."),
  ).toBeVisible();
});

it("renders as a compact banner, not a full screen, above an open workspace", async () => {
  const mdbase = await createTestMdbase();
  render(<AccountUpgradeWait mdbase={mdbase} variant="banner" />);
  expect(screen.queryByRole("main")).toBeNull();
  expect(
    screen.getByRole("region", { name: "Your collection is being upgraded" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
});
