// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import type {
  AppWebSignInSessionOptions,
  AppWebCloudCopyHost,
  AppBundledReleaseTrust,
} from "@mdbase-dev/sdk/app-host";
import type {
  NextOpenedCollection,
  NextInstallationBuildInput,
} from "./next-installation-protocol";
import { createNextSignInSession } from "./next-sign-in-session";
import { collectionJoinIntent } from "./next-collection-join-intent";

// Actual app join/journal boundaries with SDK session/native-host stand-ins.
// Configuration/lifetime delegation only, not native/auth/SQL qualification.
const f = vi.hoisted(() => ({
  options: null as unknown as AppWebSignInSessionOptions<NextOpenedCollection>,
  connection: null as NextOpenedCollection | null,
  listener: () => {},
  stop: vi.fn(),
  status:
    "not_started" as import("@mdbase-dev/sdk/app-host").AppWebSignInSnapshot["status"],
}));
vi.mock("@mdbase-dev/sdk/app-host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AppWebSignInSession: class {
    constructor(options: AppWebSignInSessionOptions<NextOpenedCollection>) {
      f.options = options;
    }
    connection() {
      return f.connection;
    }
    setForeground() {}
    subscribe(listener: () => void) {
      f.listener = listener;
      return f.stop;
    }
    getSnapshot() {
      return { status: f.status };
    }
  },
}));
const account = "11111111-1111-4111-8111-111111111111",
  installation = "22222222-2222-4222-8222-222222222222",
  collection = "33333333-3333-4333-8333-333333333333";
const release: AppBundledReleaseTrust = {
  schema: "mdbn-app-trust/release/1",
  environment: "lab",
  cpOrigin: "https://connect-lab.mdbase.dev",
  logOrigin: "https://log.example.test",
  assetSha256: "11".repeat(32),
  trustedRoots: [new Uint8Array(32).fill(1)],
  policyPins: Uint8Array.of(1),
  source: {
    repository: "mdbase-dev/mdbase-connect",
    commit: "22".repeat(20),
    version: "unit-only",
  },
};
const build: NextInstallationBuildInput = {
  environment: "lab",
  appOrigin: "http://127.0.0.1:48218",
  release,
  appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
  appName: "TaskNotes",
  runtime: Uint8Array.of(1, 2),
  runtimeSha256: "11".repeat(32),
};
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  f.connection = null;
  f.status = "not_started";
  f.stop.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  const parent = new AbortController(),
    portal = { navigate: vi.fn(), close: vi.fn() };
  const wrapper = createNextSignInSession({
    build,
    signal: parent.signal,
    locks: undefined,
    openPortal: () => portal,
  });
  const host = {
    bootstrapCloudCopy: vi.fn<
      (
        options: Parameters<AppWebCloudCopyHost["bootstrapCloudCopy"]>[0],
      ) => Promise<void>
    >(async () => {}),
    registeredReceipt: () => ({
      deviceId: account,
      installationId: installation,
    }),
    openCollectionSql: vi.fn(async () => {}),
    startCollectionLog: vi.fn(async () => {}),
    waitForVerifiedRead: vi.fn(async () => {}),
    attachDataFacade: vi.fn(),
    driveCollection: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const context = {
    host: host as unknown as AppWebCloudCopyHost,
    installation: {
      scope: { account, installation },
      isCurrent: () => !parent.signal.aborted,
    },
    scope: Object.freeze({ account, installation, collection }),
    collection: {
      collectionId: collection,
      displayName: "Work",
      role: "owner" as const,
    },
    setupPolicy: "approved-new-collection" as const,
    signal: parent.signal,
  };
  return { wrapper, parent, portal, host, context };
}
it("uses the public SDK owner/popup and exact original scope, without app auth, attestation or lease APIs", () => {
  const fixtureValue = fixture();
  expect(f.options).toMatchObject({
    appId: build.appId,
    appName: "TaskNotes",
    signal: fixtureValue.parent.signal,
    origin: build.appOrigin,
    cpOrigin: release.cpOrigin,
    requestedCreateCollections: true,
  });
  expect(f.options.openPortal()).toBe(fixtureValue.portal);
  expect(fixtureValue.host.bootstrapCloudCopy).not.toHaveBeenCalled();
  expect(fixtureValue.portal.navigate).not.toHaveBeenCalled();
});
it("CP-created selections JOIN once and expose one stable data-only handle, never a READY claim", async () => {
  const fixtureValue = fixture();
  const adapter = await f.options.openCollection!(fixtureValue.context);
  expect(fixtureValue.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
  expect(fixtureValue.host.bootstrapCloudCopy.mock.calls[0]?.[0]).toMatchObject(
    {
      scope: fixtureValue.context.scope,
      purpose: "join",
      outcomeMode: "fresh",
      allowLoopbackHttp: true,
    },
  );
  expect(adapter.state).toBe("setup_required");
  expect(adapter.connection).toBe(adapter.connection);
  f.connection = adapter.connection;
  const first = fixtureValue.wrapper.takeConnection(collection);
  expect(Object.keys(first).sort()).toEqual([
    "channel",
    "displayName",
    "kind",
    "requiresTaskNotesModelSetup",
    "scope",
    "startupTiming",
  ]);
  expect(Object.keys(first.startupTiming!).sort()).toEqual([
    "bootstrap",
    "native_open",
    "sql_open",
    "verified_read",
  ]);
  expect(
    Object.values(first.startupTiming!).every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
  ).toBe(true);
  expect(() => fixtureValue.wrapper.takeConnection(collection)).toThrow(
    "already handed off",
  );
  await fixtureValue.wrapper.verified();
  expect(adapter.state).toBe("setup_required");
  await adapter.close();
  expect(fixtureValue.host.close).not.toHaveBeenCalled();
});
it("restores the original attempted join without a fresh bootstrap", async () => {
  const fixtureValue = fixture();
  expect(
    await collectionJoinIntent(
      fixtureValue.context.scope,
      fixtureValue.parent.signal,
      "prepare",
    ),
  ).toBe("fresh");
  const adapter = await f.options.openCollection!(fixtureValue.context);
  expect(fixtureValue.host.bootstrapCloudCopy.mock.calls[0]?.[0]).toMatchObject(
    {
      purpose: "join",
      outcomeMode: "existing",
      reconcile: "explicit-unknown-outcome",
    },
  );
  await adapter.close();
});
it("abort during bootstrap prevents SQL/facade and preserves the original attempted join", async () => {
  const fixtureValue = fixture();
  let finish!: () => void, entered!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  fixtureValue.host.bootstrapCloudCopy.mockImplementation(async () => {
    entered();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const open = f.options.openCollection!(fixtureValue.context);
  await inside;
  fixtureValue.parent.abort();
  finish();
  await expect(open).rejects.toMatchObject({ reason: "fenced" });
  expect(fixtureValue.host.openCollectionSql).not.toHaveBeenCalled();
  expect(fixtureValue.host.attachDataFacade).not.toHaveBeenCalled();
  expect(
    await collectionJoinIntent(
      fixtureValue.context.scope,
      new AbortController().signal,
      "prepare",
    ),
  ).toBe("existing");
  expect(fixtureValue.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
});
