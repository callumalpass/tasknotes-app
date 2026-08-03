import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { describe, expect, it } from "vitest";

import { SCRATCHPAD_TYPE } from "../domain/scratchpad";
import { MemoryVault } from "../test/memory-vault";
import { MarkdownCollection } from "./collection";
import { IndexedMarkdownRepository } from "./repository";

describe("local scratchpad repository", () => {
  it("creates one typed active file, saves it, and archives a linked outline", async () => {
    const vault = new MemoryVault();
    const repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
    });
    await repository.initialize();

    const active = await repository.getActiveScratchpad();
    expect(active).toMatchObject({
      path: "scratchpads/Scratchpad.md",
      state: "active",
    });
    const source = parseFrontmatter(await vault.readText(active.path));
    expect(source.frontmatter).toMatchObject({
      type: SCRATCHPAD_TYPE,
      id: active.id,
      state: "active",
      dateCreated: expect.any(String),
      dateModified: expect.any(String),
    });
    expect(await repository.getActiveScratchpad()).toMatchObject({
      id: active.id,
    });

    const saved = await repository.saveScratchpad({
      ...active,
      body: "- [ ] Draft announcement tomorrow\n- Context only\n",
    });
    const result = await repository.archiveScratchpad({
      ...saved,
      title: "Launch plan",
      body: "- [[tasks/announcement|Draft announcement]]\n- Context only\n",
    });

    expect(result.archived).toMatchObject({
      state: "converted",
      title: "Launch plan",
      dateConverted: expect.any(String),
    });
    expect(result.archived.path).toMatch(
      /^scratchpads\/\d{4}-\d{2}-\d{2} – Launch plan\.md$/,
    );
    expect(result.archived.body).toContain("[[tasks/announcement");
    expect(result.active).toMatchObject({
      state: "active",
      path: "scratchpads/Scratchpad.md",
      body: "",
    });
    expect(result.active.id).not.toBe(active.id);
  });

  it("refuses stale writes and multiple active scratchpads", async () => {
    const vault = new MemoryVault();
    const collection = new MarkdownCollection(vault);
    const repository = new IndexedMarkdownRepository({ collection });
    await repository.initialize();
    const active = await repository.getActiveScratchpad();

    await expect(
      repository.saveScratchpad({
        ...active,
        revision: "sha256:stale",
        body: "- [ ] Overwrite\n",
      }),
    ).rejects.toThrow("changed after it was opened");

    const duplicate = (await vault.readText(active.path)).replace(
      active.id,
      crypto.randomUUID(),
    );
    await vault.writeText("scratchpads/Other.md", duplicate);
    await expect(repository.getActiveScratchpad()).rejects.toThrow(
      "More than one active scratchpad",
    );
  });
});
