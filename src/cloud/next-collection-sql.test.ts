import { openNextCollectionSql } from "./next-collection-sql";
const fixture = vi.hoisted(() => ({
  asset: vi.fn(),
  init: vi.fn(),
  open: vi.fn(),
  sql: vi.fn(),
  close: vi.fn(),
  pause: vi.fn(),
  fence: vi.fn(),
  needsRecovery: false,
}));
vi.mock("./next-bundled-asset", () => ({ fetchBundledAsset: fixture.asset }));
vi.mock("@sqlite.org/sqlite-wasm", () => ({ default: fixture.init }));
vi.mock("@mdbase-dev/obsidian-runtime/app-storage", () => ({
  openAppSahpoolIndex: fixture.open,
  appSqlHost: fixture.sql,
  AppBinaryIndexHost: class {
    fence() {
      fixture.fence();
      fixture.needsRecovery = true;
    }
    get needsRecovery() {
      return fixture.needsRecovery;
    }
  },
}));
const scope = {
  account: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  collection: "33333333-3333-4333-8333-333333333333",
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.needsRecovery = false;
  fixture.asset.mockResolvedValue(Uint8Array.of(1));
  fixture.init.mockResolvedValue({});
  fixture.open.mockResolvedValue({
    index: {
      info: { opened: "Fresh", sqliteVersion: 3053004 },
      close: fixture.close,
    },
    pool: { pauseVfs: fixture.pause },
  });
  fixture.close.mockImplementation(() => {});
  fixture.pause.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
function worker() {
  vi.stubGlobal(
    "WorkerGlobalScope",
    class {
      static [Symbol.hasInstance](value: unknown) {
        return value === globalThis;
      }
    },
  );
}
// Worker/storage callback stand-ins, not actual OPFS/native READ qualification.
describe("original Worker SQLite intake", () => {
  it("refuses a main-thread fallback before fetching or opening any SQL", async () => {
    await expect(
      openNextCollectionSql({ scope, signal: new AbortController().signal }),
    ).rejects.toThrow("original Worker");
    expect(fixture.asset).not.toHaveBeenCalled();
    expect(fixture.open).not.toHaveBeenCalled();
  });
  it("uses checked immutable WASM, actual opened metadata and a dynamic lifetime fence", async () => {
    worker();
    const signal = new AbortController().signal;
    const opened = await openNextCollectionSql({ scope, signal });
    expect(fixture.asset).toHaveBeenCalledWith(
      expect.any(String),
      "2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752",
      1_100_000,
      signal,
    );
    expect(fixture.init).toHaveBeenCalledWith(
      expect.objectContaining({ wasmBinary: Uint8Array.of(1) }),
    );
    expect(fixture.open).toHaveBeenCalledWith({}, scope);
    expect(opened.opened).toBe("fresh");
    expect(opened.sqliteVersion).toBe(3053004);
    opened.sql.import({} as never);
    expect(fixture.sql).toHaveBeenCalledOnce();
    expect(opened.sql.needsRecovery).toBe(false);
    opened.sql.fence();
    expect(opened.sql.needsRecovery).toBe(true);
    const closing = opened.close();
    expect(opened.close()).toBe(closing);
    await closing;
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.pause).toHaveBeenCalledOnce();
  });
  it("a failed SQL shutdown is fenced and cannot be retried into a successful close", async () => {
    worker();
    const opened = await openNextCollectionSql({
      scope,
      signal: new AbortController().signal,
    });
    fixture.close.mockImplementationOnce(() => {
      throw Error("shutdown failed");
    });
    const first = opened.close();
    await expect(first).rejects.toThrow("shutdown failed");
    expect(opened.close()).toBe(first);
    await expect(opened.close()).rejects.toThrow("shutdown failed");
    expect(opened.sql.needsRecovery).toBe(true);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.pause).not.toHaveBeenCalled();
  });
  it("late SQL acquisition after cancellation closes and fences it before returning", async () => {
    worker();
    const owner = new AbortController();
    fixture.open.mockImplementationOnce(async () => {
      owner.abort();
      return {
        index: {
          info: { opened: "Fresh", sqliteVersion: 3053004 },
          close: fixture.close,
        },
        pool: { pauseVfs: fixture.pause },
      };
    });
    await expect(
      openNextCollectionSql({ scope, signal: owner.signal }),
    ).rejects.toThrow();
    expect(fixture.fence).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.pause).toHaveBeenCalledOnce();
  });
  it("an unsupported VFS never becomes an in-memory store", async () => {
    worker();
    fixture.open.mockRejectedValueOnce(Error("VFS unavailable"));
    await expect(
      openNextCollectionSql({ scope, signal: new AbortController().signal }),
    ).rejects.toThrow("VFS unavailable");
    expect(fixture.open).toHaveBeenCalledOnce();
  });
});
