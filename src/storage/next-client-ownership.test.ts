import { describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { NextTaskRepository } from "./next-repository";

describe("native repository client lifetime (SDK stand-in, not native durability)", () => {
  it("releases a borrowed repository without closing the shared original client", async () => {
    const f = await nextTaskFixture({ confirmDelayMs: null });
    const close = vi.spyOn(f.client, "close");
    // The existing model flag keeps this test structurally typed even before
    // the explicit ownership option is implemented; no SDK/client cast.
    const ownership = {
      requiresTaskNotesModelSetup: false,
      clientOwnership: "borrowed" as const,
    };
    const restored = new NextTaskRepository(
      f.client,
      "Borrowed metadata reader",
      f.accountId,
      ownership,
    );
    try {
      const note = await f.repository.getActiveScratchpad();
      const before = (await f.client.pendingWrites()).map(
        (w) => w.receipt.mutation,
      );
      await restored.initialize({ deferTaskIndex: true });
      expect((await restored.getScratchpad(note.id))?.id).toBe(note.id);
      restored.dispose();
      expect(close).not.toHaveBeenCalled();
      expect((await f.repository.getScratchpad(note.id))?.id).toBe(note.id);
      expect(
        (await f.client.pendingWrites()).map((w) => w.receipt.mutation),
      ).toEqual(before);
      await expect(restored.getScratchpad(note.id)).rejects.toThrow("disposed");
    } finally {
      f.close();
    }
  });

  it("keeps the existing default owned-client teardown", async () => {
    const f = await nextTaskFixture();
    const close = vi.spyOn(f.client, "close");
    try {
      f.repository.dispose();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      f.close();
    }
  });
});
