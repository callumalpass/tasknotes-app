import { tasknotesSettingsDefinition } from "@tasknotes/model/settings";
import { describe, expect, it, vi } from "vitest";

import {
  AppSettingsStore,
  type AppSettingsRecord,
  type AppSettingsRecordPort,
} from "./app-settings-store";

/** One settings record behind a port, revisioned like a collection. */
function recordPort(initial: Record<string, Record<string, unknown>> = {}) {
  const records = new Map<string, AppSettingsRecord>(
    Object.entries(initial).map(([path, frontmatter]) => [
      path,
      { frontmatter, revision: "r1" },
    ]),
  );
  let revision = 1;
  const next = (path: string, frontmatter: Record<string, unknown>) => {
    const record = { frontmatter, revision: `r${(revision += 1)}` };
    records.set(path, record);
    return record;
  };
  const port = {
    read: vi.fn(async (path: string) => records.get(path) ?? null),
    create: vi.fn(
      async (input: { path: string; frontmatter: Record<string, unknown> }) =>
        next(input.path, input.frontmatter),
    ),
    update: vi.fn(
      async (input: {
        path: string;
        revision?: string;
        patch: Record<string, unknown>;
      }) => {
        const record = records.get(input.path);
        if (input.revision !== record?.revision)
          throw new Error("concurrent_modification");
        const frontmatter = { ...record!.frontmatter };
        for (const [key, value] of Object.entries(input.patch))
          if (value === null) delete frontmatter[key];
          else frontmatter[key] = value;
        return next(input.path, frontmatter);
      },
    ),
    classify: (reason: unknown) => {
      if (!(reason instanceof Error)) return undefined;
      if (reason.message === "concurrent_modification") return "raced" as const;
      if (reason.message === "not_found") return "not_found" as const;
      return undefined;
    },
  } satisfies AppSettingsRecordPort;
  /** Another client's write. */
  const external = (patch: Record<string, unknown>, path = CURRENT_PATH) =>
    next(path, { ...records.get(path)!.frontmatter, ...patch });
  return { port, external, records };
}

const CURRENT_PATH = "_mdbase/settings/dev.tasknotes.md";
const LEGACY_PATH = "_settings/dev.tasknotes.md";

const RECORD = {
  app: "dev.tasknotes",
  scope: "collection",
  settings_version: 1,
  archive_folder: "Archive",
  move_on_archive: true,
};

describe("app settings store", () => {
  it.each([
    { name: "new only", paths: [CURRENT_PATH], selected: CURRENT_PATH },
    { name: "legacy only", paths: [LEGACY_PATH], selected: LEGACY_PATH },
    {
      name: "both (new wins)",
      paths: [CURRENT_PATH, LEGACY_PATH],
      selected: CURRENT_PATH,
    },
    { name: "neither (create new)", paths: [], selected: CURRENT_PATH },
  ])(
    "reads and saves at the selected path: $name",
    async ({ paths, selected }) => {
      const initial = Object.fromEntries(
        paths.map((path) => [path, { ...RECORD, archive_folder: path }]),
      );
      const { port, records } = recordPort(initial);
      const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
      const snapshot = await store.current();
      expect(store.path).toBe(selected);
      expect(snapshot.frontmatter).toEqual(initial[selected]);
      expect(port.read.mock.calls.map(([path]) => path)).toEqual(
        paths.includes(CURRENT_PATH)
          ? [CURRENT_PATH]
          : [CURRENT_PATH, LEGACY_PATH],
      );
      expect(port.create).not.toHaveBeenCalled();
      expect(port.update).not.toHaveBeenCalled();

      expect((await store.save({ archive_folder: "Saved" }, snapshot)).ok).toBe(
        true,
      );
      if (paths.length) {
        expect(port.create).not.toHaveBeenCalled();
        expect(port.update).toHaveBeenCalledExactlyOnceWith(
          {
            path: selected,
            revision: "r1",
            patch: { archive_folder: "Saved" },
          },
          undefined,
        );
      } else {
        expect(port.update).not.toHaveBeenCalled();
        expect(port.create).toHaveBeenCalledExactlyOnceWith(
          {
            path: CURRENT_PATH,
            type: "tasknotes-settings",
            frontmatter: {
              app: "dev.tasknotes",
              scope: "collection",
              settings_version: 1,
              archive_folder: "Saved",
            },
          },
          undefined,
        );
      }
      expect([...records.keys()]).toEqual(
        paths.length ? paths : [CURRENT_PATH],
      );
      for (const path of paths.filter((path) => path !== selected))
        expect(records.get(path)?.frontmatter).toEqual(initial[path]);
    },
  );

  it.each([LEGACY_PATH, undefined])(
    "treats not_found as absence before using %s",
    async (existing) => {
      const { port } = recordPort(existing ? { [existing]: RECORD } : {});
      port.read.mockImplementation(async (path) => {
        if (path === existing) return { frontmatter: RECORD, revision: "r1" };
        throw new Error("not_found");
      });
      const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
      expect((await store.current()).status).toBe("ready");
      expect(store.path).toBe(existing ?? CURRENT_PATH);
      expect((await store.save({ archive_folder: "Saved" })).ok).toBe(true);
    },
  );

  it("does not fall back or write when the new path cannot be read", async () => {
    const { port } = recordPort({ [LEGACY_PATH]: RECORD });
    port.read.mockRejectedValue(new Error("Access refused"));
    const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
    expect(await store.current()).toMatchObject({
      status: "failed",
      problem: "Access refused",
    });
    expect(port.read.mock.calls).toEqual([[CURRENT_PATH, undefined]]);
    expect(await store.save({ archive_folder: "Saved" })).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(port.create).not.toHaveBeenCalled();
    expect(port.update).not.toHaveBeenCalled();
  });

  it.each([CURRENT_PATH, LEGACY_PATH])(
    "names the record actually read in refusals: %s",
    async (path) => {
      const { port } = recordPort({
        [path]: { ...RECORD, app: "another.app" },
      });
      const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
      expect(await store.save({ archive_folder: "Saved" })).toMatchObject({
        ok: false,
        reason: "read_only",
        message: `${path} names another app, so it is left as it is.`,
      });
      expect(port.create).not.toHaveBeenCalled();
      expect(port.update).not.toHaveBeenCalled();
    },
  );

  it("keeps a legacy record's path and revision guard when retrying a race", async () => {
    const { port, external } = recordPort({ [LEGACY_PATH]: RECORD });
    port.update.mockImplementationOnce(async () => {
      external({ move_on_archive: false }, LEGACY_PATH);
      throw new Error("concurrent_modification");
    });
    const store = new AppSettingsStore(port, tasknotesSettingsDefinition);
    expect(await store.save({ archive_folder: "Saved" })).toMatchObject({
      ok: true,
      snapshot: {
        frontmatter: { archive_folder: "Saved", move_on_archive: false },
      },
    });
    expect(port.update.mock.calls.map(([input]) => input)).toEqual([
      { path: LEGACY_PATH, revision: "r1", patch: { archive_folder: "Saved" } },
      { path: LEGACY_PATH, revision: "r2", patch: { archive_folder: "Saved" } },
    ]);
    expect(port.create).not.toHaveBeenCalled();
  });

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
    const { port, external } = recordPort({ [CURRENT_PATH]: RECORD });
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
