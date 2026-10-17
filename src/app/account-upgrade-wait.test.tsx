import { act, fireEvent, render, screen } from "@testing-library/react";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { expect, it, vi } from "vitest";
import type { MdbaseSnapshot } from "@mdbase-dev/sdk";
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
it("offers friendly copy and read-only retry without displaying error codes", async () => {
  const start = vi
    .fn()
    .mockRejectedValueOnce(new Error("secret technical detail"));
  const assess = vi.fn();
  const mdbase = { ...(await createTestMdbase()), start, assess };
  render(<AccountUpgradeWait mdbase={mdbase} />);
  expect(
    screen.getByText(
      /this usually completes within a day. Your tasks are safe/,
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => {});
  expect(start).toHaveBeenCalledOnce();
  expect(assess).not.toHaveBeenCalled();
  expect(
    screen.getByText("Still waiting. Please try again later."),
  ).toBeVisible();
  expect(screen.queryByText(/secret technical detail/)).toBeNull();
});
