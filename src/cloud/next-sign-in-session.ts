import {
  AppWebSignInSession,
  selectAppEnvironment,
  type AppWebSignInSessionOptions,
  type AppWebCollectionConnection,
  type AppWebSignInPortal,
  type AppLockPort,
} from "@mdbase-dev/sdk/app-host";
import { StartupTiming } from "../observability/startup-timing";
import {
  logCollectionOpenFailure,
  type CollectionOpenStage,
} from "./next-collection-open-diagnostic";
import { collectionJoinIntent } from "./next-collection-join-intent";
import { findCollectionCreation } from "./next-collection-create-intent";
import { openNextCollectionSql } from "./next-collection-sql";
import { NextModelSetupIntentStore } from "./next-model-setup-intent";
import type {
  NextInstallationBuildInput,
  NextInstallationCommand,
  NextOpenedCollection,
} from "./next-installation-protocol";

/** SDK9ab public session plus the existing single-port collection boundary.
 * Sign-in, approval polling, HOST and both leases belong solely to the SDK.
 * This adapter retains only the existing journal/drive/data-port seams until
 * the separate shared-factory/two-port adoption. No auth controller is reused.
 */
export function createNextSignInSession({
  build,
  signal,
  locks,
  openPortal,
}: {
  build: NextInstallationBuildInput;
  signal: AbortSignal;
  locks: AppLockPort | undefined;
  openPortal(): AppWebSignInPortal;
}) {
  const environment = selectAppEnvironment({
    environment: build.environment,
    appOrigin: build.appOrigin,
    release: build.release,
  });
  const runtime = new Uint8Array(build.runtime);
  let adapter: NextSessionCollection | null = null;
  let timing: StartupTiming | null = null;
  let endNativeOpen: (() => void) | undefined;
  const session = new AppWebSignInSession<NextOpenedCollection>({
    environment: build.environment,
    release: build.release,
    origin: build.appOrigin,
    cpOrigin: environment.cpOrigin,
    appId: build.appId,
    appName: build.appName,
    signal,
    locks,
    openPortal,
    // The Connect window owns explicit pick/create consent. This asks for that
    // choice, not permission inferred from restored metadata or a UI checkbox.
    requestedCreateCollections: true,
    fetch: (input, init) => globalThis.fetch(input, init),
    loadRuntime: async ({ signal }) => {
      signal.throwIfAborted();
      return new Uint8Array(runtime);
    },
    openCollection: async (context) => {
      let next: NextSessionCollection | null = null;
      try {
        next = new NextSessionCollection(
          context,
          build.appOrigin,
          environment.cpOrigin,
          environment.allowLoopbackHttp,
          (timing ??= new StartupTiming()),
        );
        adapter = next;
        endNativeOpen ??= timing.begin("native_open");
        return await next.open();
      } catch (error) {
        logCollectionOpenFailure(
          next?.openStage ?? "construct",
          error,
          typeof location === "undefined" ? undefined : location.href,
        );
        throw error;
      } finally {
        endNativeOpen?.();
      }
    },
  });
  let opening = false;
  const stopTiming = session.subscribe(() => {
    const next = session.getSnapshot().status === "opening";
    if (next && !opening) {
      timing = new StartupTiming();
      endNativeOpen = timing.begin("native_open");
    }
    opening = next;
  });
  signal.addEventListener("abort", stopTiming, { once: true });
  return {
    session,
    takeConnection(collectionId: string) {
      const connection = session.connection();
      if (!adapter || connection?.scope.collection !== collectionId)
        throw Object.assign(Error("Original collection unavailable."), {
          reason: "fenced",
        });
      return adapter.takeConnection();
    },
    journal(
      command: Extract<
        NextInstallationCommand,
        {
          kind: "model-setup-intent" | "model-resource-setup-intent";
        }
      >,
    ) {
      if (!session.connection() || !adapter)
        throw Object.assign(Error("Original journal unavailable."), {
          reason: "fenced",
        });
      return adapter.journal(command);
    },
    async verified() {
      if (!session.connection() || !adapter)
        throw Object.assign(Error("Original journal unavailable."), {
          reason: "fenced",
        });
      await adapter.verified();
    },
    foreground(active: boolean) {
      session.setForeground(active);
      if (session.connection()) adapter?.foreground(active);
    },
  };
}

type CollectionContext = Parameters<
  NonNullable<
    AppWebSignInSessionOptions<NextOpenedCollection>["openCollection"]
  >
>[0];
class NextSessionCollection implements AppWebCollectionConnection<NextOpenedCollection> {
  // Native READ/discovery/history is not current semantic readiness. The UI's
  // existing repository/setup gate still assesses the full compatible model.
  readonly state = "setup_required" as const;
  openStage: CollectionOpenStage = "current_check";
  private readonly lifetime = new AbortController();
  private readonly signal: AbortSignal;
  private readonly scope;
  private readonly store: NextModelSetupIntentStore;
  private channel: MessageChannel | null = null;
  private attached = false;
  private handedOff = false;
  private value: NextOpenedCollection | null = null;
  private active = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private driving: Promise<unknown> | null = null;
  private closing: Promise<void> | null = null;
  constructor(
    private readonly context: CollectionContext,
    appOrigin: string,
    cpOrigin: string,
    private readonly allowLoopbackHttp: boolean,
    private readonly timing: StartupTiming,
  ) {
    this.scope = Object.freeze({ ...context.scope });
    this.signal = AbortSignal.any([context.signal, this.lifetime.signal]);
    this.store = new NextModelSetupIntentStore({
      scope: this.scope,
      appOrigin,
      cpOrigin,
      isCurrent: () => this.current(),
    });
  }
  private current() {
    return (
      !this.closing &&
      !this.signal.aborted &&
      this.context.installation.isCurrent() &&
      this.context.scope.account === this.scope.account &&
      this.context.scope.installation === this.scope.installation &&
      this.context.scope.collection === this.scope.collection &&
      this.context.collection.collectionId === this.scope.collection
    );
  }
  private check() {
    if (!this.current())
      throw Object.assign(Error("Original collection unavailable."), {
        reason: "fenced",
      });
  }
  async open(): Promise<this> {
    this.check();
    const { host } = this.context,
      signal = this.signal;
    try {
      this.openStage = "creation_intent";
      const creation = await findCollectionCreation(
        this.context.installation.scope,
        this.scope.collection,
        signal,
      );
      this.check();
      if (creation?.phase === "prepared")
        throw Object.assign(Error("Original creation unresolved."), {
          reason: "outcome_unknown",
        });
      // New CP-selected collections already exist: JOIN, never create them.
      // Retained legacy creation witnesses preserve their original EXISTING
      // bootstrap identity/purpose, without a fresh create or replacement.
      this.openStage = "join_intent";
      const mode = creation
        ? "existing"
        : await collectionJoinIntent(this.scope, signal, "prepare");
      this.check();
      this.openStage = "bootstrap";
      const endBootstrap = this.timing.begin("bootstrap");
      try {
        await host.bootstrapCloudCopy({
          scope: this.scope,
          collectionCurrent: () => this.current(),
          purpose: creation ? "create" : "join",
          outcomeMode: mode,
          signal,
          ...(mode === "existing"
            ? { reconcile: "explicit-unknown-outcome" as const }
            : {}),
          fetch: (input, init) => globalThis.fetch(input, init),
          allowLoopbackHttp: this.allowLoopbackHttp,
        });
      } finally {
        endBootstrap();
      }
      this.check();
      this.openStage = "join_complete";
      if (!creation) await collectionJoinIntent(this.scope, signal, "complete");
      this.check();
      this.openStage = "receipt";
      const receipt = host.registeredReceipt();
      if (receipt.installationId !== this.scope.installation)
        throw Object.assign(Error("Original collection binding."), {
          reason: "binding",
        });
      this.openStage = "sql_open";
      const endSql = this.timing.begin("sql_open");
      try {
        await host.openCollectionSql({
          signal,
          replicaId: receipt.deviceId,
          endpoint: 0,
          openSql: openNextCollectionSql,
        });
      } finally {
        endSql();
      }
      this.check();
      this.openStage = "verified_read";
      const endRead = this.timing.begin("verified_read");
      try {
        await host.startCollectionLog({
          signal,
          fetch: (input, init) => globalThis.fetch(input, init),
          allowLoopbackHttp: this.allowLoopbackHttp,
        });
        await host.waitForVerifiedRead({ signal });
      } finally {
        endRead();
      }
      this.check();
      this.openStage = "data_facade";
      this.channel = new MessageChannel();
      host.attachDataFacade(this.channel.port1);
      this.attached = true;
      this.schedule();
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  get connection(): NextOpenedCollection {
    this.check();
    if (!this.channel || !this.attached)
      throw Object.assign(Error("Original facade unavailable."), {
        reason: "fenced",
      });
    return (this.value ??= {
      kind: "collection",
      scope: this.scope,
      displayName: this.context.collection.displayName,
      // The existing setup gate provides current semantic readiness; do not
      // invent a creator-history flag from CP metadata or a verified callback.
      requiresTaskNotesModelSetup: false,
      channel: this.channel.port2,
      startupTiming: this.timing.snapshot(),
    });
  }
  takeConnection() {
    if (this.handedOff)
      throw Object.assign(Error("Original facade already handed off."), {
        reason: "fenced",
      });
    const value = this.connection;
    this.handedOff = true;
    return value;
  }
  async journal(
    command: Extract<
      NextInstallationCommand,
      { kind: "model-setup-intent" | "model-resource-setup-intent" }
    >,
  ) {
    this.check();
    const store = this.store,
      signal = this.signal;
    const resource = command.kind === "model-resource-setup-intent";
    switch (command.action) {
      case "load":
        return store.load(signal);
      case "prepare-round":
        return store.prepareResourceRound(
          command.plan,
          command.previousMutationId,
          signal,
        );
      case "prepare":
        return resource
          ? store.prepareResources(command.plan, signal)
          : store.prepare(command.plan, signal);
      case "attempt":
        return resource
          ? store.recordResourceAttempt(command.mutationId, signal)
          : store.recordAttempt(command.mutationId, signal);
      case "confirm":
        return resource
          ? store.recordResourceConfirmed(command.mutationId, signal)
          : store.recordConfirmed(command.mutationId, signal);
      case "verify":
        return resource
          ? store.recordResourceVerified(command.mutationId, signal)
          : store.recordVerified(command.mutationId, signal);
    }
  }
  async verified() {
    this.check();
    // This acknowledges the UI service's completion only. It is not an SDK
    // READY assertion, not a new admission and not a creation metadata rewrite.
    await this.store.load(this.signal);
    this.check();
  }
  foreground(active: boolean) {
    this.check();
    this.active = active;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (active) this.schedule();
  }
  private schedule() {
    if (!this.current() || !this.active || this.timer !== null || this.driving)
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.current() || !this.active) return;
      const work = (this.driving = this.context.host.driveCollection({
        signal: this.signal,
      }));
      void work.then(
        () => {
          this.driving = null;
          this.schedule();
        },
        () => {
          this.driving = null;
          this.active = false;
        },
      );
    }, 250);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.lifetime.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.closing = Promise.resolve().then(async () => {
      await this.driving?.catch(() => {});
      this.channel?.port1.close();
      this.channel?.port2.close();
      this.store.close();
      // SDK session stops HOST native, then SQL, then releases its leases.
    });
    return this.closing;
  }
}
