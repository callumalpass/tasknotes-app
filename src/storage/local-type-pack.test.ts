import { describe, expect, it, vi } from "vitest";
import {
  buildTaskNotesMdbaseResources,
  buildTaskNotesMdbaseTypePack,
  type TaskNotesMdbaseTypePack,
} from "@tasknotes/model/mdbase";

import { MemoryVault } from "../test/memory-vault";
import {
  applyLocalTypePack,
  type DefinitionAdoptionRequest,
} from "./local-type-pack";

describe("local type-pack lifecycle", () => {
  it("treats the browser's OPFS NotFoundError as an absent definition", async () => {
    const vault = new MemoryVault();
    const readText = vault.readText.bind(vault);
    vi.spyOn(vault, "readText").mockImplementation(async (path) => {
      try {
        return await readText(path);
      } catch {
        throw new DOMException(
          "A requested file or directory could not be found at the time an operation was processed.",
          "NotFoundError",
        );
      }
    });

    await expect(
      applyLocalTypePack(vault, await taskPack(), {
        installedBy: "dev.tasknotes.app",
      }),
    ).resolves.toBeUndefined();
    expect(await vault.readText("_contracts/tasknotes.task.md")).toContain(
      "kind: mdbase.contract",
    );
  });

  it("installs managed definitions, seeds the user-owned type, and records provenance", async () => {
    const vault = new MemoryVault();
    const pack = await taskPack();

    await applyLocalTypePack(vault, pack, {
      installedBy: "dev.tasknotes.app",
    });

    expect(await vault.readText("_contracts/tasknotes.task.md")).toBe(
      resource(pack, "_contracts/tasknotes.task.md"),
    );
    expect(await vault.readText("_types/task.md")).toBe(
      resource(pack, "_types/task.md"),
    );
    const lock = JSON.parse(await vault.readText("mdbase.lock.yaml"));
    expect(lock.packs[0]).toMatchObject({
      id: "tasknotes.task",
      installed_by: "dev.tasknotes.app",
    });
    expect(
      lock.packs[0].resources.find(
        ({ target }: { target: string }) => target === "_types/task.md",
      ),
    ).toMatchObject({
      mode: "seed",
      source: "types/task.md",
    });
  });

  it("keeps the canonical pack identity while resolving collection-specific definition folders", async () => {
    const vault = new MemoryVault();
    const pack = await taskPack();

    await applyLocalTypePack(vault, pack, {
      installedBy: "dev.tasknotes.app",
      targetOverrides: {
        "_contracts/tasknotes.task.md":
          "definitions/contracts/tasknotes.task.md",
        "_types/task.md": "definitions/types/task.md",
      },
    });

    expect(
      await vault.readText("definitions/contracts/tasknotes.task.md"),
    ).toBe(resource(pack, "_contracts/tasknotes.task.md"));
    expect(await vault.readText("definitions/types/task.md")).toBe(
      resource(pack, "_types/task.md"),
    );
    const lock = JSON.parse(await vault.readText("mdbase.lock.yaml"));
    expect(lock.packs[0].digest).toBe(
      await sha256(canonicalJson(pack.manifest)),
    );
    expect(lock.packs[0].resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "contracts/tasknotes.task.md",
          target: "definitions/contracts/tasknotes.task.md",
        }),
      ]),
    );
  });

  it("upgrades clean managed resources while preserving a customized seed", async () => {
    const vault = new MemoryVault();
    const first = await taskPack();
    await applyLocalTypePack(vault, first, {
      installedBy: "dev.tasknotes.app",
    });
    await vault.writeText("_types/task.md", "A user-owned task type.\n");
    const next = await revisedPack(first);

    await applyLocalTypePack(vault, next, {
      installedBy: "dev.tasknotes.app",
    });

    expect(await vault.readText("_types/task.md")).toBe(
      "A user-owned task type.\n",
    );
    expect(await vault.readText("_contracts/tasknotes.task.md")).toBe(
      resource(next, "_contracts/tasknotes.task.md"),
    );
  });

  it("never overwrites a managed definition changed after installation", async () => {
    const vault = new MemoryVault();
    const first = await taskPack();
    await applyLocalTypePack(vault, first, {
      installedBy: "dev.tasknotes.app",
    });
    const changed = `${await vault.readText("_contracts/tasknotes.task.md")}User edit.\n`;
    await vault.writeText("_contracts/tasknotes.task.md", changed);

    await expect(
      applyLocalTypePack(vault, await revisedPack(first), {
        installedBy: "dev.tasknotes.app",
        approveAdoption: () => true,
      }),
    ).rejects.toThrow("changed after");
    expect(await vault.readText("_contracts/tasknotes.task.md")).toBe(changed);
  });

  it("requires explicit review to adopt differing unmanaged definitions", async () => {
    const vault = new MemoryVault();
    const pack = await taskPack();
    await vault.writeText("_contracts/tasknotes.task.md", "Older contract.\n");
    const approve = vi.fn(
      (request: DefinitionAdoptionRequest) => request.resources.length > 0,
    );

    await applyLocalTypePack(vault, pack, {
      installedBy: "dev.tasknotes.app",
      approveAdoption: approve,
    });

    expect(approve).toHaveBeenCalledOnce();
    expect(approve.mock.calls[0]?.[0].resources).toEqual([
      expect.objectContaining({ path: "_contracts/tasknotes.task.md" }),
    ]);
    expect(await vault.readText("_contracts/tasknotes.task.md")).toBe(
      resource(pack, "_contracts/tasknotes.task.md"),
    );
  });
});

async function taskPack(): Promise<TaskNotesMdbaseTypePack> {
  return buildTaskNotesMdbaseTypePack(buildTaskNotesMdbaseResources());
}

async function revisedPack(
  source: TaskNotesMdbaseTypePack,
): Promise<TaskNotesMdbaseTypePack> {
  const pack = structuredClone(source);
  pack.manifest.version = "0.3.0-rc.10";
  const contract = pack.resources.find(
    (candidate) => candidate.source === "contracts/tasknotes.task.md",
  );
  if (!contract) throw new Error("Missing test contract.");
  contract.document += "\nUpdated package documentation.\n";
  const declaration = pack.manifest.resources.find(
    (candidate) => candidate.source === contract.source,
  );
  if (!declaration) throw new Error("Missing test declaration.");
  declaration.digest = await sha256(contract.document);
  return pack;
}

function resource(pack: TaskNotesMdbaseTypePack, target: string): string {
  const declaration = pack.manifest.resources.find(
    (candidate) => candidate.target === target,
  );
  const value = pack.resources.find(
    (candidate) => candidate.source === declaration?.source,
  );
  if (!value) throw new Error(`Missing test resource ${target}.`);
  return value.document;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
