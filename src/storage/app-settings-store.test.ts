import { tasknotesSettingsDefinition } from "@tasknotes/model/settings";
import { describe, expect, it, vi } from "vitest";

import {
  AppSettingsStore,
  type AppSettingsRecord,
  type AppSettingsRecordPort,
} from "./app-settings-store";

/** One settings record behind a port, revisioned like a collection. */
function recordPort(initial?: Record<string, unknown>) {
  let record: AppSettingsRecord | null = initial
    ? { frontmatter: initial, revision: "r1" }
    : null;
  let revision = 1;
  const next = (frontmatter: Record<string, unknown>) =>
    (record = { frontmatter, revision: `r${(revision += 1)}` });
  const port = {
    read: vi.fn(async () => record),
    create: vi.fn(async (input: { frontmatter: Record<string, unknown> }) =>
      next(input.frontmatter),
    ),
    update: vi.fn(
      async (input: { revision?: string; patch: Record<string, unknown> }) => {
        if (input.revision !== record?.revision)
          throw new Error("concurrent_modification");
        const frontmatter = { ...record!.frontmatter };
        for (const [key, value] of Object.entries(input.patch))
          if (value === null) delete frontmatter[key];
          else frontmatter[key] = value;
        return next(frontmatter);
      },
    ),
    classify: (reason: unknown) =>
      reason instanceof Error && reason.message === "concurrent_modification"
        ? ("raced" as const)
        : undefined,
  } satisfies AppSettingsRecordPort;
  /** Another client's write. */
  const external = (patch: Record<string, unknown>) =>
    next({ ...record!.frontmatter, ...patch });
  return { port, external };
}

const RECORD = {
  app: "dev.tasknotes",
  scope: "collection",
  settings_version: 1,
  archive_folder: "Archive",
  move_on_archive: true,
};

describe("app settings store", () => {
  it("creates the record on the first save and then patches only changed fields", async () => {
    const { port } = recordPort();
    const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
    expect((await store.current()).settings.values.move_on_archive).toBe(false);
    expect(port.create).not.toHaveBeenCalled();

    await store.save({ move_on_archive: true });
    expect(port.create).toHaveBeenCalledOnce();
    expect(port.create.mock.calls[0]![0].frontmatter).toEqual({
      app: "dev.tasknotes",
      scope: "collection",
      settings_version: 1,
      move_on_archive: true,
    });

    const saved = await store.save({
      move_on_archive: true,
      archive_folder: "Done",
    });
    expect(saved.ok).toBe(true);
    expect(port.update.mock.calls.map(([input]) => input.patch)).toEqual([
      { archive_folder: "Done" },
    ]);
  });

  it("refuses a save that conflicts with another client's change, writing nothing", async () => {
    const { port, external } = recordPort(RECORD);
    const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
    const prepared = await store.current();
    external({ archive_folder: "Elsewhere" });
    await store.reload();

    const result = await store.save({ archive_folder: "Mine" }, prepared);
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      fields: ["archive_folder"],
    });
    expect(port.update).not.toHaveBeenCalled();
  });
});
