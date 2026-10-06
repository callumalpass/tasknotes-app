import type { MdbaseConnection } from "@mdbase-dev/connect";
import { accountBackend } from "@mdbase-dev/connect/control";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openConsentingAccountRepository } from "./account-repository";
import { taskRepositoryStub } from "../test/task-repository-stub";

vi.mock("@mdbase-dev/connect/control", () => ({ accountBackend: vi.fn() }));
const metadata = {
  accountId: "00000000-0000-4000-8000-000000000001",
  backend: "next" as const,
};
const connection = {} as MdbaseConnection;
afterEach(() => vi.resetAllMocks());
function factories() {
  return {
    legacy: vi.fn(() => taskRepositoryStub({})),
    next: vi.fn(async () => taskRepositoryStub({})),
  };
}

describe("pre-data account opening (metadata port stand-in)", () => {
  it("does not start either data/setup factory before authenticated detection", async () => {
    const factory = factories();
    let release!: (info: typeof metadata) => void;
    vi.mocked(accountBackend).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const opening = openConsentingAccountRepository(
      connection,
      factory,
      options,
    );
    expect(accountBackend).toHaveBeenCalledWith(connection, options);
    expect(factory.legacy).not.toHaveBeenCalled();
    expect(factory.next).not.toHaveBeenCalled();
    release(metadata);
    await opening;
    expect(factory.next).toHaveBeenCalledWith(metadata);
    expect(factory.legacy).not.toHaveBeenCalled();
  });

  it("opens the unchanged legacy factory only for explicit legacy metadata", async () => {
    const factory = factories();
    const account = { ...metadata, backend: "legacy" as const };
    vi.mocked(accountBackend).mockResolvedValue(account);
    await openConsentingAccountRepository(connection, factory);
    expect(factory.legacy).toHaveBeenCalledWith(account);
    expect(factory.next).not.toHaveBeenCalled();
  });

  it("a detection failure never guesses legacy or starts setup", async () => {
    const factory = factories();
    vi.mocked(accountBackend).mockRejectedValue(
      new Error("Authorization changed"),
    );
    await expect(
      openConsentingAccountRepository(connection, factory),
    ).rejects.toThrow("Authorization changed");
    expect(factory.legacy).not.toHaveBeenCalled();
    expect(factory.next).not.toHaveBeenCalled();
  });

  it("a selected next failure never retries through legacy", async () => {
    const factory = factories();
    vi.mocked(accountBackend).mockResolvedValue(metadata);
    factory.next.mockRejectedValue(new Error("No authorized device online"));
    await expect(
      openConsentingAccountRepository(connection, factory),
    ).rejects.toThrow("No authorized device online");
    expect(factory.legacy).not.toHaveBeenCalled();
  });

  it("a pre-aborted opening does not request metadata", async () => {
    const factory = factories();
    await expect(
      openConsentingAccountRepository(connection, factory, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(accountBackend).not.toHaveBeenCalled();
    expect(factory.legacy).not.toHaveBeenCalled();
    expect(factory.next).not.toHaveBeenCalled();
  });

  it("late metadata after cancellation never starts a data factory", async () => {
    const factory = factories();
    const controller = new AbortController();
    vi.mocked(accountBackend).mockImplementation(async () => {
      controller.abort();
      return metadata;
    });
    await expect(
      openConsentingAccountRepository(connection, factory, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(factory.legacy).not.toHaveBeenCalled();
    expect(factory.next).not.toHaveBeenCalled();
  });

  it("disposes an opening completed after its scope was cancelled", async () => {
    const factory = factories();
    const repository = taskRepositoryStub({});
    const dispose = vi.fn();
    repository.dispose = dispose;
    const controller = new AbortController();
    vi.mocked(accountBackend).mockResolvedValue(metadata);
    factory.next.mockImplementation(async () => {
      controller.abort();
      return repository;
    });
    await expect(
      openConsentingAccountRepository(connection, factory, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(factory.legacy).not.toHaveBeenCalled();
  });
});
