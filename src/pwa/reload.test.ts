import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());

it("awaits existing editor saves before checking and never reloads on a rejected save", async () => {
  const { registerReloadParticipant, saveBeforeReload } =
    await import("./reload");
  let finish!: () => void;
  const check = vi.fn();
  const remove = registerReloadParticipant({
    save: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    check,
  });
  const pending = saveBeforeReload();
  expect(check).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(check).toHaveBeenCalledOnce();
  remove();
  registerReloadParticipant({
    save: async () => {
      throw new Error("uncertain save");
    },
  });
  await expect(saveBeforeReload()).rejects.toThrow("uncertain save");
});

it("checks for newer unsaved edits and unregisters closed editors", async () => {
  const { registerReloadParticipant, saveBeforeReload } =
    await import("./reload");
  const remove = registerReloadParticipant({
    check: () => {
      throw new Error("draft remains");
    },
  });
  await expect(saveBeforeReload()).rejects.toThrow("draft remains");
  remove();
  await expect(saveBeforeReload()).resolves.toBeUndefined();
});

it("flushes pending commands and preserves rejection", async () => {
  const { TaskMutations } = await import("../application/task-mutations");
  const mutations = new TaskMutations();
  let finish!: () => void;
  void mutations.run(
    "save",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = mutations.flush();
  await Promise.resolve();
  expect(mutations.hasPending()).toBe(true);
  finish();
  await pending;
  expect(mutations.hasPending()).toBe(false);
  void mutations.run("save", async () => {
    throw new Error("conflict");
  });
  await expect(mutations.flush()).rejects.toThrow("conflict");
});
