import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppProtectedInstallationSignIn,
  AppWebCloudCopyHost,
  type AppBundledReleaseTrust,
  type AppInstallationSignInView,
  type AppLockPort,
} from "@mdbase-dev/sdk/app-host";
import { NextTaskNotesInstallation } from "./next-installation";

const account = "11111111-1111-4111-8111-111111111111";
const installation = "22222222-2222-4222-8222-222222222222";
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
    version: "test-unit-only",
  },
};
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const events: string[] = [];
  let owned = false;
  const ctrl = new AbortController();
  let view: AppInstallationSignInView = {
    requestId: account,
    installationId: installation,
    deviceId: account,
    appId: "tasknotes-web",
    kind: "app-runtime",
    verificationUri: `${release.cpOrigin}/pair/${account}`,
    state: "pending",
    accountId: null,
    collectionIds: [],
    createCollections: false,
    requestedCreateCollections: false,
  };
  const flow = {
    view: vi.fn(() => view),
    start: vi.fn(async () => {
      events.push("start");
      return view;
    }),
    exchange: vi.fn(async () => view),
    confirmSelectedAccount: vi.fn(async (id: string) => {
      if (id !== account) throw Error("binding");
      events.push("confirm");
      view = { ...view, accountId: account, state: "account_confirmed" };
      return view;
    }),
    confirmedSelection: () => ({
      accountId: account,
      installationId: installation,
    }),
    listApprovedCollections: vi.fn(async () => []),
    startCollectionConsent: vi.fn(async () => ({ state: "pending" })),
    exchangeCollectionConsent: vi.fn(async () => ({ state: "scope_updated" })),
    close: vi.fn(async () => {
      events.push("flow-close");
    }),
  };
  const host = {
    attestInstallation: vi.fn(async () => ({
      ...view,
      state: "awaiting_approval",
    })),
    completeInstallationSignIn: vi.fn(async () => ({})),
    close: vi.fn(async () => {
      events.push("host-close");
    }),
  };
  const open = vi
    .spyOn(AppProtectedInstallationSignIn, "open")
    .mockResolvedValue(flow as unknown as AppProtectedInstallationSignIn);
  const openHost = vi
    .spyOn(AppWebCloudCopyHost, "openInstallationDevice")
    .mockImplementation(async (options) => {
      expect(owned).toBe(true);
      expect(events).toContain("confirm");
      expect(options.installation.isCurrent()).toBe(true);
      events.push("host-open");
      return host as unknown as AppWebCloudCopyHost;
    });
  const locks: AppLockPort = {
    request: async (_name, _options, hold) => {
      owned = true;
      events.push("lease");
      try {
        await hold({});
      } finally {
        owned = false;
        events.push("unlock");
      }
    },
  };
  const options = {
    environment: "lab" as const,
    appOrigin: "http://127.0.0.1:48218",
    release,
    mode: "fresh" as const,
    signal: ctrl.signal,
    locks,
    loadRuntime: vi.fn(async () => Uint8Array.of(1)),
  };
  return {
    events,
    ctrl,
    flow,
    host,
    open,
    openHost,
    options,
    setView: (next: Partial<AppInstallationSignInView>) => {
      view = { ...view, ...next };
    },
  };
}

describe("ordinary native installation controller (source mocks, not LAB acceptance)", () => {
  it("opens explicit protected context without starting HTTP or native keys", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    expect(s.open).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "lab",
        origin: s.options.appOrigin,
        cpOrigin: release.cpOrigin,
        mode: "fresh",
      }),
    );
    expect(s.flow.start).not.toHaveBeenCalled();
    expect(s.openHost).not.toHaveBeenCalled();
    expect(s.events).not.toContain("lease");
    expect(app.view()).not.toHaveProperty("token");
    await app.close();
  });
  it("provides native fetch with its original GlobalScope receiver, not an SDK instance receiver", async () => {
    const s = setup();
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(function (
      this: unknown,
    ) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const app = await NextTaskNotesInstallation.open(s.options);
    const captured = s.open.mock.calls[0]![0];
    await captured.fetch!(`${release.cpOrigin}/health`);
    expect(request).toHaveBeenCalledOnce();
    await app.close();
  });
  it("requires explicit account confirmation and ownership before native device", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await expect(app.confirmAccountAndOpenDevice(installation)).rejects.toThrow(
      "binding",
    );
    expect(s.openHost).not.toHaveBeenCalled();
    await app.confirmAccountAndOpenDevice(account);
    expect(s.events.slice(0, 3)).toEqual(["confirm", "lease", "host-open"]);
    await app.close();
    expect(s.events.slice(-3)).toEqual(["host-close", "flow-close", "unlock"]);
  });
  it("completes only the original protected paired receipt before collection metadata", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await expect(app.listApprovedCollections()).rejects.toThrow("approval");
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", collectionIds: [account] });
    await app.exchange();
    expect(s.host.completeInstallationSignIn).toHaveBeenCalledOnce();
    await app.listApprovedCollections();
    expect(s.flow.listApprovedCollections).toHaveBeenCalledOnce();
    await app.startCollectionConsent();
    expect(s.flow.startCollectionConsent).toHaveBeenCalledWith(
      expect.anything(),
      false,
    );
    await app.exchangeCollectionConsent();
    expect(s.open).toHaveBeenCalledOnce();
    expect(s.openHost).toHaveBeenCalledOnce();
    await app.close();
  });
  it("has no automatic unknown-outcome retry", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    s.flow.start.mockRejectedValueOnce(Error("outcome_unknown"));
    await expect(app.start()).rejects.toThrow("outcome_unknown");
    expect(s.flow.start).toHaveBeenCalledOnce();
    await app.start();
    expect(s.flow.start).toHaveBeenCalledTimes(2);
    expect(s.open).toHaveBeenCalledOnce();
    await app.close();
  });
  it("drains delayed original slot acquisition on abort before cleanup", async () => {
    const s = setup(),
      pending = deferred<AppProtectedInstallationSignIn>();
    s.open.mockReturnValueOnce(pending.promise);
    const opening = NextTaskNotesInstallation.open(s.options);
    const refused = expect(opening).rejects.toThrow("lifetime");
    await Promise.resolve();
    s.ctrl.abort();
    expect(s.flow.close).not.toHaveBeenCalled();
    pending.resolve(s.flow as unknown as AppProtectedInstallationSignIn);
    await refused;
    expect(s.flow.close).toHaveBeenCalledOnce();
  });
  it("drains device acquisition on close and refuses late result", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options),
      pending = deferred<AppWebCloudCopyHost>();
    s.openHost.mockReturnValueOnce(pending.promise);
    const opening = app.confirmAccountAndOpenDevice(account);
    const refused = expect(opening).rejects.toThrow("lifetime");
    await vi.waitFor(() => expect(s.openHost).toHaveBeenCalledOnce());
    const closing = app.close();
    expect(s.events).not.toContain("unlock");
    pending.resolve(s.host as unknown as AppWebCloudCopyHost);
    await refused;
    await closing;
    expect(s.events.slice(-3)).toEqual(["host-close", "flow-close", "unlock"]);
  });
  it("retains the lease if native close fails and fences all later operations", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.host.close.mockRejectedValueOnce(Error("native shutdown failed"));
    await expect(app.close()).rejects.toThrow("native shutdown failed");
    expect(s.events).not.toContain("unlock");
    expect(s.flow.close).not.toHaveBeenCalled();
    await expect(app.start()).rejects.toThrow("lifetime");
  });
});
