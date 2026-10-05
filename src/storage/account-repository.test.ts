import { describe, expect, it, vi } from "vitest";
import { taskRepositoryStub } from "../test/task-repository-stub";
import { openAccountRepository } from "./account-repository";

function fixture() {
  const legacyRepository = taskRepositoryStub({});
  const nextRepository = taskRepositoryStub({});
  return {
    legacyRepository,
    nextRepository,
    factories: {
      legacy: vi.fn(() => legacyRepository),
      next: vi.fn(async () => nextRepository),
    },
  };
}

describe("explicit account backend selection", () => {
  it("legacy opens the existing repository without starting next", async () => {
    const f = fixture();
    expect(await openAccountRepository("legacy", f.factories)).toBe(
      f.legacyRepository,
    );
    expect(f.factories.legacy).toHaveBeenCalledOnce();
    expect(f.factories.next).not.toHaveBeenCalled();
  });

  it("next opens only the native v2 repository", async () => {
    const f = fixture();
    expect(await openAccountRepository("next", f.factories)).toBe(
      f.nextRepository,
    );
    expect(f.factories.next).toHaveBeenCalledOnce();
    expect(f.factories.legacy).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "NEXT", "v2", "future", 1, {}, ["legacy"]])(
    "refuses unsupported discriminator %j before opening either backend",
    async (backend) => {
      const f = fixture();
      await expect(openAccountRepository(backend, f.factories)).rejects.toThrow(
        "unsupported account backend",
      );
      expect(f.factories.legacy).not.toHaveBeenCalled();
      expect(f.factories.next).not.toHaveBeenCalled();
    },
  );

  it.each(["legacy", "next"] as const)(
    "does not fail over when %s fails",
    async (backend) => {
      const f = fixture();
      const failure = new Error("Authentication or connectivity failed");
      f.factories[backend].mockImplementation(() => {
        throw failure;
      });
      await expect(openAccountRepository(backend, f.factories)).rejects.toBe(
        failure,
      );
      expect(
        f.factories[backend === "legacy" ? "next" : "legacy"],
      ).not.toHaveBeenCalled();
    },
  );
});
