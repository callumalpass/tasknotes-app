import type {
  AppWebCollectionHandoff,
  AppWebSignInPortal,
} from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "./next-installation-protocol";
import { createTaskNotesWebSignInSession } from "./next-web-sign-in-session";

// Configuration/delegation tests only. SDK stand-ins do not authenticate BUILD,
// open SQL/native storage, exercise real sign-in or qualify an app session.
const seams = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  adapters: [] as Record<string, unknown>[],
  environment: vi.fn(() => ({
    cpOrigin: "https://connect-lab.mdbase.dev",
    allowLoopbackHttp: true,
  })),
  openCollection: vi.fn(),
}));
vi.mock("@mdbase-dev/sdk/app-host", () => ({
  selectAppEnvironment: seams.environment,
  createAppWebCollectionAdapter: (options: Record<string, unknown>) => {
    seams.adapters.push(options);
    return seams.openCollection;
  },
  AppWebSignInSession: class {
    constructor(options: Record<string, unknown>) {
      seams.sessions.push(options);
    }
  },
}));
vi.mock("@sqlite.org/sqlite-wasm", () => ({ default: vi.fn() }));
vi.mock("./next-bundled-asset", () => ({ fetchBundledAsset: vi.fn() }));

beforeEach(() => {
  seams.sessions.length = 0;
  seams.adapters.length = 0;
  seams.environment.mockClear();
});
function fixture() {
  const build: NextInstallationBuildInput = {
    environment: "lab",
    appOrigin: "http://127.0.0.1:48218",
    appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    appName: "TaskNotes",
    release: {} as NextInstallationBuildInput["release"],
    runtime: new Uint8Array([1, 2, 3]),
    runtimeSha256: "a".repeat(64),
  };
  const owner = new AbortController();
  const openPortal = vi.fn((): AppWebSignInPortal => ({
    navigate: vi.fn(),
    close: vi.fn(),
  }));
  const handoff = vi.fn<(value: AppWebCollectionHandoff) => void>();
  return { build, owner, openPortal, handoff };
}

it("configures the one public session/factory with the exact original namespaces and SDK-owned SQL", () => {
  const f = fixture();
  const locks = { request: vi.fn() };
  createTaskNotesWebSignInSession({
    ...f,
    signal: f.owner.signal,
    locks,
    requestedCreateCollections: true,
  });
  expect(seams.environment).toHaveBeenCalledExactlyOnceWith({
    environment: "lab",
    appOrigin: f.build.appOrigin,
    release: f.build.release,
  });
  expect(seams.sessions).toHaveLength(1);
  expect(seams.adapters).toHaveLength(1);
  expect(seams.adapters[0]).toMatchObject({
    joinDatabaseName: "tasknotes.native-collection-join.v1",
    setupJournal: {
      databaseName: "tasknotes.native-model-setup.v1",
      applicationNamespace: "tasknotes-web",
      appOrigin: f.build.appOrigin,
      cpOrigin: "https://connect-lab.mdbase.dev",
    },
    sql: {
      wasmSha256:
        "2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752",
      maxWasmBytes: 1_100_000,
      loadWasm: expect.any(Function),
      initialize: expect.any(Function),
    },
    handoff: f.handoff,
  });
  expect(seams.sessions[0]).toMatchObject({
    appId: f.build.appId,
    appName: "TaskNotes",
    origin: f.build.appOrigin,
    cpOrigin: "https://connect-lab.mdbase.dev",
    locks,
    signal: f.owner.signal,
    openPortal: f.openPortal,
    openCollection: seams.openCollection,
    requestedCreateCollections: true,
  });
  expect(f.openPortal).not.toHaveBeenCalled();
  expect(f.handoff).not.toHaveBeenCalled();
});

it("captures the original runtime bytes and retains each loader's cancellation", async () => {
  const f = fixture();
  createTaskNotesWebSignInSession({
    ...f,
    signal: f.owner.signal,
    locks: undefined,
  });
  const load = seams.sessions[0]!.loadRuntime as (options: {
    signal: AbortSignal;
  }) => Promise<Uint8Array>;
  f.build.runtime.fill(9);
  const first = await load({ signal: f.owner.signal });
  expect(first).toEqual(new Uint8Array([1, 2, 3]));
  first.fill(8);
  expect(await load({ signal: f.owner.signal })).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  f.owner.abort();
  await expect(load({ signal: f.owner.signal })).rejects.toBe(
    f.owner.signal.reason,
  );
});

it("refuses an already-aborted owner before environment, adapter or session construction", () => {
  const f = fixture();
  f.owner.abort();
  expect(() =>
    createTaskNotesWebSignInSession({
      ...f,
      signal: f.owner.signal,
      locks: undefined,
    }),
  ).toThrow();
  expect(seams.environment).not.toHaveBeenCalled();
  expect(seams.adapters).toHaveLength(0);
  expect(seams.sessions).toHaveLength(0);
});
