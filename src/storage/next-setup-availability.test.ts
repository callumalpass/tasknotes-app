import { expect, it, vi } from "vitest";
import { ModelSetupError } from "../application/ports/model-setup";
import { modelResourceInventory } from "./next-model-resources";
import { setupAvailability } from "./next-setup-availability";
import type { wire } from "@mdbase-dev/sdk";

const status = (
  confirmedThrough = 2,
  headKnown = 5,
  keyWait = false,
): wire.SyncStatus => ({
  mode: "synced",
  connection: "online",
  confirmedThrough,
  headKnown,
  pending: 0,
  holds: 0,
  unresolved: 0,
  incidents: keyWait ? [{ kind: "waiting_for_key" }] : [],
});

it("does not mistake ONLINE/pending-zero with a lagging prefix for model absence", async () => {
  const list = vi.fn(async () => ({ resources: [], complete: true }));
  const client = { status: status(), resources: { list } };
  await expect(
    modelResourceInventory(client, new AbortController().signal),
  ).rejects.toMatchObject({
    view: { state: "waiting", reason: "catching_up" },
  });
  expect(list).not.toHaveBeenCalled();
});

it("prioritizes key wait over catch-up even without a reported lag", () => {
  expect(setupAvailability(status(5, 5, true))).toMatchObject({
    state: "waiting",
    reason: "waiting_for_access",
  });
});

it("refuses an apparently complete inventory when catch-up changes during its read", async () => {
  const client = {
    status: status(5, 5),
    resources: {
      list: vi.fn(async () => {
        client.status = status(5, 6);
        return { resources: [], complete: true };
      }),
    },
  };
  await expect(
    modelResourceInventory(client, new AbortController().signal),
  ).rejects.toBeInstanceOf(ModelSetupError);
  expect(client.resources.list).toHaveBeenCalledOnce();
});

it("clearing the negative fence does not replace native inventory", async () => {
  const client = {
    status: status(5, 5),
    resources: {
      list: vi.fn(async () => ({ resources: [], complete: true })),
    },
  };
  expect(setupAvailability(client.status)).toBeNull();
  await expect(
    modelResourceInventory(client, new AbortController().signal),
  ).resolves.toEqual([]);
  expect(client.resources.list).toHaveBeenCalledOnce();
});

it("does not classify pending ordinary task writes as setup catch-up", () => {
  const pending: wire.SyncStatus = { ...status(5, 5), pending: 3 };
  expect(setupAvailability(pending)).toBeNull();
});
