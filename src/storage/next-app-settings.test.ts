import { TASKNOTES_SETTINGS_TYPE } from "@tasknotes/model/settings";
import { expect, it, vi } from "vitest";

import { nextTaskFixture, seedRecord } from "../test/next-task-fixture";

const CURRENT_PATH = "_mdbase/settings/dev.tasknotes.md";
const LEGACY_PATH = "_settings/dev.tasknotes.md";

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
  "reads and saves settings through the SDK: $name",
  async ({ paths, selected }) => {
    const fixture = await nextTaskFixture();
    try {
      fixture.catalog.types.push({
        name: TASKNOTES_SETTINGS_TYPE,
        path: "_mdbase/types/tasknotes-settings.md",
        implements: [],
      });
      for (const path of paths)
        seedRecord(fixture.replica, {
          path,
          types: [TASKNOTES_SETTINGS_TYPE],
          frontmatter: {
            app: "dev.tasknotes",
            scope: "collection",
            settings_version: 1,
            archive_folder: path,
            move_on_archive: true,
            future_field: "Keep",
          },
          body: "Keep this body",
        });
      await fixture.repository.initialize();
      if (paths.length)
        expect(
          (await fixture.repository.taskConfiguration()).archive.folder,
        ).toBe(selected);

      const before = await Promise.all(
        paths.map((path) =>
          fixture.client.find({ path }, { include: { body: true } }),
        ),
      );
      const update = vi.spyOn(fixture.client, "update");
      await fixture.repository.updateTaskModelSettings({
        archive: { folder: "Saved" },
      });
      if (paths.length) {
        const original = before[paths.indexOf(selected)]!;
        expect(update).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ id: original.id, path: selected }),
          expect.objectContaining({ ifRevision: original.revision }),
          expect.anything(),
        );
      } else expect(update).not.toHaveBeenCalled();
      const saved = await fixture.client.find(
        { path: selected },
        { include: { body: true } },
      );
      expect(saved?.frontmatter).toMatchObject({
        app: "dev.tasknotes",
        scope: "collection",
        settings_version: 1,
        archive_folder: "Saved",
        ...(paths.length
          ? { move_on_archive: true, future_field: "Keep" }
          : {}),
      });
      expect(saved?.body).toBe(paths.length ? "Keep this body" : "");
      for (const path of [CURRENT_PATH, LEGACY_PATH].filter(
        (path) => path !== selected,
      ))
        expect(
          await fixture.client.find({ path }, { include: { body: true } }),
        ).toEqual(before[paths.indexOf(path)] ?? null);
    } finally {
      fixture.close();
    }
  },
);
