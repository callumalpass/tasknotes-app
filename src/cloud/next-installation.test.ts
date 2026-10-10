// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  AppProtectedInstallationSignIn,
  AppWebCloudCopyHost,
  type AppBundledReleaseTrust,
  type AppInstallationSignInView,
  type AppLockPort,
} from "@mdbase-dev/sdk/app-host";
import { NextTaskNotesInstallation } from "./next-installation";
import { collectionCreateIntent } from "./next-collection-create-intent";
import { resourceSetupPlan } from "../test/resource-setup-plan";
import { TASKNOTES_APPLICATION_REGISTRATION } from "./next-application-registration";

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
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
    appId: TASKNOTES_APPLICATION_REGISTRATION.appId,
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
    renewExpiredPairing: vi.fn(async () => {
      events.push("renew-expired");
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
    bootstrapCloudCopy: vi.fn<AppWebCloudCopyHost["bootstrapCloudCopy"]>(
      async () => {
        events.push("bootstrap");
        return {} as never;
      },
    ),
    registeredReceipt: vi.fn(() => ({ deviceId: account })),
    openCollectionSql: vi.fn(async () => {
      events.push("sql");
    }),
    startCollectionLog: vi.fn(async () => {
      events.push("log");
    }),
    driveCollection: vi.fn(async () => {
      events.push("drive");
    }),
    waitForVerifiedRead: vi.fn(async () => {
      events.push("read");
    }),
    attachDataFacade: vi.fn(() => {
      events.push("facade");
    }),
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
    ...TASKNOTES_APPLICATION_REGISTRATION,
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
        appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
        appName: "TaskNotes",
        mode: "fresh",
      }),
    );
    expect(s.flow.start).not.toHaveBeenCalled();
    expect(s.openHost).not.toHaveBeenCalled();
    expect(s.events).not.toContain("lease");
    expect(app.view()).not.toHaveProperty("token");
    await app.close();
  });
  it("does not retry a refused original restore with fresh mode or an alias", async () => {
    const s = setup();
    s.open.mockRejectedValueOnce(
      Object.assign(new Error("Sign in again"), {
        reason: "recovery_required",
      }),
    );
    await expect(
      NextTaskNotesInstallation.open({ ...s.options, mode: "existing" }),
    ).rejects.toMatchObject({ reason: "recovery_required" });
    expect(s.open).toHaveBeenCalledOnce();
    expect(s.open.mock.calls[0]![0]).toMatchObject({
      ...TASKNOTES_APPLICATION_REGISTRATION,
      origin: s.options.appOrigin,
      environment: "lab",
      mode: "existing",
    });
    expect(s.flow.start).not.toHaveBeenCalled();
    expect(s.openHost).not.toHaveBeenCalled();
    expect(s.events).not.toContain("lease");
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
  it("exposes one same-host data port only after native read, with a separate collection lease", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", collectionIds: [account] });
    s.flow.listApprovedCollections.mockResolvedValue([
      { collectionId: account, displayName: "Tasks", role: "owner" },
    ] as never);
    const result = await app.openApprovedCollection(account);
    expect(result.scope).toEqual({
      account,
      installation,
      collection: account,
    });
    expect(s.events.slice(-6)).toEqual([
      "lease",
      "bootstrap",
      "sql",
      "log",
      "read",
      "facade",
    ]);
    expect(s.host.openCollectionSql).toHaveBeenCalledWith(
      expect.objectContaining({ replicaId: account, endpoint: 0 }),
    );
    expect(s.openHost).toHaveBeenCalledOnce();
    await expect(app.openApprovedCollection(account)).rejects.toThrow(
      "unavailable",
    );
    result.channel.close();
    await app.close();
    expect(s.events.slice(-4)).toEqual([
      "host-close",
      "flow-close",
      "unlock",
      "unlock",
    ]);
  });
  it("carries v3 actions on the same protected collection ledger without converting legacy actions", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    const load = {
      kind: "model-setup-intent" as const,
      action: "load" as const,
    };
    await expect(app.modelSetupIntent(load)).rejects.toMatchObject({
      reason: "fenced",
    });
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", collectionIds: [account] });
    s.flow.listApprovedCollections.mockResolvedValue([
      { collectionId: account, displayName: "Tasks", role: "owner" },
    ] as never);
    const opened = await app.openApprovedCollection(account);
    expect(await app.modelSetupIntent(load)).toBeNull();
    const plan = resourceSetupPlan();
    const original = await app.modelSetupIntent({
      kind: "model-resource-setup-intent",
      action: "prepare",
      plan,
    });
    expect(original).toMatchObject({
      version: 3,
      scope: opened.scope,
      plan,
      phase: "prepared",
    });
    for (const [action, phase] of [
      ["attempt", "attempted"],
      ["confirm", "confirmed"],
      ["verify", "verified"],
    ] as const) {
      const command = {
        kind: "model-resource-setup-intent" as const,
        action,
        mutationId: original!.mutationId,
      };
      expect(await app.modelSetupIntent(command)).toEqual({
        ...original,
        phase,
      });
      expect(await app.modelSetupIntent(load)).toEqual({ ...original, phase });
      await expect(
        app.modelSetupIntent({
          kind: "model-setup-intent",
          action,
          mutationId: original!.mutationId,
        }),
      ).rejects.toMatchObject({ reason: "recovery_required" });
    }
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
    expect(s.openHost).toHaveBeenCalledOnce();
    opened.channel.close();
    await app.close();
    await expect(app.modelSetupIntent(load)).rejects.toThrow();
  });
  it("creates one durable target with the original host and collection-only lease", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: true });
    const created = await app.createCloudCopyCollection();
    expect(created.kind).toBe("created-collection");
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { account, installation, collection: created.collectionId },
        purpose: "create",
        outcomeMode: "fresh",
      }),
    );
    expect(s.events.filter((e) => e === "lease")).toHaveLength(2);
    expect(await app.createCloudCopyCollection(true)).toEqual(created);
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
    expect(s.openHost).toHaveBeenCalledOnce();
    await app.close();
    expect(s.events.slice(-4)).toEqual([
      "host-close",
      "flow-close",
      "unlock",
      "unlock",
    ]);
  });
  it("opens a just-created collection without a second bootstrap or collection lease", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: true });
    const created = await app.createCloudCopyCollection();
    s.flow.listApprovedCollections.mockResolvedValue([
      {
        collectionId: created.collectionId,
        displayName: "New collection",
        role: "owner",
      },
    ] as never);
    const opened = await app.openApprovedCollection(created.collectionId);
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
    expect(s.events.filter((e) => e === "lease")).toHaveLength(2);
    expect(s.host.waitForVerifiedRead).toHaveBeenCalledOnce();
    expect(s.host.attachDataFacade).toHaveBeenCalledOnce();
    opened.channel.close();
    await app.close();
  });
  it("restores a completed creation with purpose create after the original installation is reopened", async () => {
    const s = setup(),
      first = await NextTaskNotesInstallation.open(s.options);
    await first.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: true });
    const created = await first.createCloudCopyCollection();
    await first.close();
    const second = await NextTaskNotesInstallation.open({
      ...s.options,
      mode: "existing",
    });
    await second.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired" });
    s.flow.listApprovedCollections.mockResolvedValue([
      {
        collectionId: created.collectionId,
        displayName: "New collection",
        role: "owner",
      },
    ] as never);
    const opened = await second.openApprovedCollection(created.collectionId);
    expect(s.host.bootstrapCloudCopy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: { account, installation, collection: created.collectionId },
        purpose: "create",
        outcomeMode: "existing",
        reconcile: "explicit-unknown-outcome",
      }),
    );
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledTimes(2);
    opened.channel.close();
    await second.close();
  });
  it("foreground log drive pauses, resumes and stops with the original owner", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup(),
        app = await NextTaskNotesInstallation.open(s.options);
      await app.confirmAccountAndOpenDevice(account);
      s.setView({ state: "paired" });
      s.flow.listApprovedCollections.mockResolvedValue([
        { collectionId: account, displayName: "Tasks", role: "owner" },
      ] as never);
      const opened = await app.openApprovedCollection(account);
      app.setForeground(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(s.host.driveCollection).not.toHaveBeenCalled();
      app.setForeground(true);
      await vi.advanceTimersByTimeAsync(251);
      expect(s.host.driveCollection).toHaveBeenCalledOnce();
      opened.channel.close();
      await app.close();
      await vi.advanceTimersByTimeAsync(1000);
      expect(s.host.driveCollection).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("close drains an in-flight log drive before native shutdown or ownership release", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup(),
        app = await NextTaskNotesInstallation.open(s.options);
      await app.confirmAccountAndOpenDevice(account);
      s.setView({ state: "paired" });
      s.flow.listApprovedCollections.mockResolvedValue([
        { collectionId: account, displayName: "Tasks", role: "owner" },
      ] as never);
      const opened = await app.openApprovedCollection(account),
        drive = deferred<void>();
      s.host.driveCollection.mockReturnValueOnce(drive.promise);
      await vi.advanceTimersByTimeAsync(251);
      const closing = app.close();
      await Promise.resolve();
      expect(s.host.close).not.toHaveBeenCalled();
      expect(s.events).not.toContain("unlock");
      drive.resolve();
      await closing;
      expect(s.host.close).toHaveBeenCalledOnce();
      expect(s.events.slice(-2)).toEqual(["unlock", "unlock"]);
      opened.channel.close();
    } finally {
      vi.useRealTimers();
    }
  });
  it("a failed native read never creates a facade or exposes a repository", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", collectionIds: [account] });
    s.flow.listApprovedCollections.mockResolvedValue([
      { collectionId: account, displayName: "Tasks", role: "owner" },
    ] as never);
    s.host.waitForVerifiedRead.mockRejectedValueOnce(Error("unavailable"));
    await expect(app.openApprovedCollection(account)).rejects.toThrow(
      "unavailable",
    );
    expect(s.host.attachDataFacade).not.toHaveBeenCalled();
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
    await expect(app.openApprovedCollection(account)).rejects.toThrow(
      "unavailable",
    );
    await app.close();
  });
  it("unapproved collection metadata cannot acquire collection ownership or bootstrap", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired" });
    await expect(app.openApprovedCollection(account)).rejects.toThrow(
      "approved",
    );
    expect(s.host.bootstrapCloudCopy).not.toHaveBeenCalled();
    expect(s.events.filter((e) => e === "lease")).toHaveLength(1);
    await app.close();
  });
  it("a second explicit creation after completion uses a new target and the same protected device", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: true });
    const first = await app.createCloudCopyCollection();
    const awaitingModel = await app.createCloudCopyCollection();
    expect(awaitingModel.collectionId).toBe(first.collectionId);
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
    // Metadata stand-in for the model service's original-owner finalizer.
    await collectionCreateIntent(
      { account, installation },
      s.options.signal,
      "model-verified",
      { expectedCollection: first.collectionId },
    );
    const second = await app.createCloudCopyCollection();
    expect(second.collectionId).not.toBe(first.collectionId);
    expect(s.host.bootstrapCloudCopy).toHaveBeenCalledTimes(2);
    expect(s.host.bootstrapCloudCopy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: { account, installation, collection: second.collectionId },
        purpose: "create",
        outcomeMode: "fresh",
      }),
    );
    expect(s.host.close).toHaveBeenCalledOnce();
    expect(s.openHost).toHaveBeenCalledTimes(2);
    expect(s.openHost.mock.calls[1]![0].signIn).toBe(s.flow);
    expect(s.events.filter((e) => e === "unlock")).toHaveLength(1);
    await app.close();
  });
  it("refuses creation before explicit paired create permission without bootstrap", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: false });
    await expect(app.createCloudCopyCollection()).rejects.toMatchObject({
      reason: "refused",
    });
    expect(s.host.bootstrapCloudCopy).not.toHaveBeenCalled();
    expect(s.events.filter((e) => e === "lease")).toHaveLength(1);
    await app.close();
  });
  it.each(["outcome_unknown", "response", "unavailable"])(
    "%s never replaces the target or automatically reissues creation",
    async (reason) => {
      const s = setup(),
        app = await NextTaskNotesInstallation.open(s.options);
      await app.confirmAccountAndOpenDevice(account);
      s.setView({ state: "paired", createCollections: true });
      s.host.bootstrapCloudCopy.mockRejectedValueOnce(
        Object.assign(Error("failed"), { reason }),
      );
      await expect(app.createCloudCopyCollection()).rejects.toMatchObject({
        reason,
      });
      const original = s.host.bootstrapCloudCopy.mock.calls[0]![0];
      await expect(app.createCloudCopyCollection()).rejects.toMatchObject({
        reason: "outcome_unknown",
      });
      expect(s.host.bootstrapCloudCopy).toHaveBeenCalledOnce();
      const recovered = await app.createCloudCopyCollection(true);
      expect(recovered.collectionId).toBe(original.scope.collection);
      expect(s.host.bootstrapCloudCopy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: original.scope,
          purpose: "create",
          outcomeMode: "existing",
          reconcile: "explicit-unknown-outcome",
        }),
      );
      expect(s.openHost).toHaveBeenCalledTimes(2);
      expect(s.openHost.mock.calls[1]![0].signIn).toBe(s.flow);
      expect(s.openHost.mock.calls[1]![0].installation).toBe(
        s.openHost.mock.calls[0]![0].installation,
      );
      expect(s.events.filter((e) => e === "lease")).toHaveLength(2);
      expect(s.open).toHaveBeenCalledOnce();
      await app.close();
    },
  );
  it("an explicit recovery without a retained creation never allocates a target", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.setView({ state: "paired", createCollections: true });
    await expect(app.createCloudCopyCollection(true)).rejects.toMatchObject({
      reason: "recovery_required",
    });
    expect(s.host.bootstrapCloudCopy).not.toHaveBeenCalled();
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
  it("explicit renewal delegates to the original flow without replacing native ownership", async () => {
    const s = setup(),
      app = await NextTaskNotesInstallation.open(s.options);
    await app.confirmAccountAndOpenDevice(account);
    s.flow.renewExpiredPairing.mockRejectedValueOnce(Error("outcome_unknown"));
    await expect(app.renewExpiredPairing()).rejects.toThrow("outcome_unknown");
    expect(s.flow.renewExpiredPairing).toHaveBeenCalledOnce();
    await app.start();
    expect(s.flow.start).toHaveBeenCalledOnce();
    expect(s.open).toHaveBeenCalledOnce();
    expect(s.openHost).toHaveBeenCalledOnce();
    expect(s.host.close).not.toHaveBeenCalled();
    expect(s.events.filter((event) => event === "lease")).toHaveLength(1);
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
