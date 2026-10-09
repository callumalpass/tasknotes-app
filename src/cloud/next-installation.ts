import { openNextCollectionSql } from "./next-collection-sql";
import { NextModelSetupIntentStore } from "./next-model-setup-intent";
import type { ModelSetupIntent } from "../application/ports/model-setup";
import {
  collectionCreateIntent,
  findCollectionCreation,
} from "./next-collection-create-intent";
import { collectionJoinIntent } from "./next-collection-join-intent";
import type {
  NextCreatedCollection,
  NextInstallationCommand,
} from "./next-installation-protocol";
import {
  AppProtectedInstallationSignIn,
  AppWebCloudCopyHost,
  acquireAppInstallationLease,
  acquireAppReplicaLease,
  selectAppEnvironment,
  type AppBundledReleaseTrust,
  type AppEnvironmentSelection,
  type AppInstallationCustodyAuthority,
  type AppInstallationSignInView,
  type AppInstallationCollectionConsentView,
  type AppInstallationCollection,
  type AppLockPort,
  type AppReplicaLease,
} from "@mdbase-dev/sdk/app-host";

export interface NextInstallationOptions {
  readonly environment: "lab" | "production";
  readonly appOrigin: string;
  /** Independently authenticated BUILD module, never a UI/redirect parameter. */
  readonly release: AppBundledReleaseTrust;
  readonly mode: "fresh" | "existing";
  readonly signal: AbortSignal;
  readonly locks: AppLockPort | undefined;
  readonly requestedCreateCollections?: boolean;
  /** Fixed bundled, authenticated native artifact intake. No alternate backend. */
  readonly loadRuntime: (options: {
    signal: AbortSignal;
  }) => Promise<Uint8Array>;
}

/** Worker-owned ordinary first-party sign-in/device lifecycle. Only public
 * views leave this controller: no credential, proof, key or custody getters.
 * Native host closes before the original flow/store and installation lease. */
export class NextTaskNotesInstallation {
  private readonly flowLifetime = new AbortController();
  private readonly hostLifetime = new AbortController();
  private flow: AppProtectedInstallationSignIn | null = null;
  private host: AppWebCloudCopyHost | null = null;
  private lease: AppReplicaLease | null = null;
  private authority: AppInstallationCustodyAuthority | null = null;
  private collectionLease: AppReplicaLease | null = null;
  private collectionAttempted = false;
  private facadeAttached = false;
  private modelSetupStore: NextModelSetupIntentStore | null = null;
  private foreground = true;
  private driveTimer: ReturnType<typeof setTimeout> | null = null;
  private driving: Promise<void> | null = null;
  private creationTarget: string | null = null;
  private creationCompleted = false;
  private closing: Promise<void> | null = null;
  private busy = false;
  private pending: Promise<unknown> | null = null;
  private readonly selection: AppEnvironmentSelection;
  private readonly onAbort = () => {
    void this.close().catch(() => {
      // Keep the lease fenced if native shutdown fails; Worker must fail-stop.
    });
  };

  private constructor(
    private readonly options: Readonly<NextInstallationOptions>,
  ) {
    this.selection = selectAppEnvironment({
      environment: options.environment,
      appOrigin: options.appOrigin,
      release: options.release,
    });
  }

  static async open(
    options: NextInstallationOptions,
  ): Promise<NextTaskNotesInstallation> {
    const controller = new NextTaskNotesInstallation(
      Object.freeze({ ...options }),
    );
    try {
      controller.check();
      options.signal.addEventListener("abort", controller.onAbort, {
        once: true,
      });
      await controller.exclusive(async () => {
        controller.flow = await AppProtectedInstallationSignIn.open({
          environment: options.environment,
          environmentSelection: controller.selection,
          origin: options.appOrigin,
          cpOrigin: controller.selection.cpOrigin,
          appId: "tasknotes-web",
          mode: options.mode,
          signal: controller.flowLifetime.signal,
          locks: options.locks,
          // Native browser/Worker fetch requires its GlobalScope receiver; the
          // SDK retains this callback as an instance member. No network proxy.
          fetch: (input, init) => globalThis.fetch(input, init),
          ...(options.requestedCreateCollections === undefined
            ? {}
            : {
                requestedCreateCollections: options.requestedCreateCollections,
              }),
        });
      });
      return controller;
    } catch (error) {
      await controller.close();
      throw error;
    }
  }

  private check(): void {
    if (
      this.closing ||
      this.options.signal.aborted ||
      this.hostLifetime.signal.aborted
    )
      throw new Error(
        "TaskNotes installation lifetime ended; preserve storage and reopen.",
      );
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    if (this.busy)
      throw new Error("TaskNotes installation operation already in progress.");
    this.busy = true;
    const operation = Promise.resolve().then(() => {
      this.check();
      return work();
    });
    this.pending = operation;
    try {
      const result = await operation;
      this.check();
      return result;
    } finally {
      if (this.pending === operation) this.pending = null;
      this.busy = false;
    }
  }

  view(): AppInstallationSignInView {
    this.check();
    if (!this.flow) throw new Error("TaskNotes installation is not open.");
    return this.flow.view();
  }

  /** Explicit same-request START/reconcile only; never automatic renewal. */
  start(): Promise<AppInstallationSignInView> {
    return this.exclusive(() => this.flow!.start());
  }

  /** Explicit typed-expiry retry, keeping the SAME Worker/native host/actor. */
  renewExpiredPairing(): Promise<AppInstallationSignInView> {
    return this.exclusive(() => this.flow!.renewExpiredPairing());
  }

  /** Called by the user after selecting/approving in the real LAB/production portal. */
  exchange(): Promise<AppInstallationSignInView> {
    return this.exclusive(async () => {
      const view = await this.flow!.exchange();
      this.check();
      if (view.state === "paired" && this.host)
        await this.host.completeInstallationSignIn();
      return view;
    });
  }

  /** Explicit visible account confirmation precedes account-scoped ownership,
   * persistent nonextractable custody and original native device creation. */
  confirmAccountAndOpenDevice(
    accountId: string,
  ): Promise<AppInstallationSignInView> {
    return this.exclusive(async () => {
      await this.flow!.confirmSelectedAccount(accountId);
      this.check();
      if (!this.authority) {
        const selected = this.flow!.confirmedSelection();
        const scope = Object.freeze({
          account: selected.accountId,
          installation: selected.installationId,
        });
        this.lease = await acquireAppInstallationLease(
          this.options.locks,
          scope,
          this.hostLifetime.signal,
        );
        this.check();
        this.authority = Object.freeze({
          scope,
          isCurrent: () =>
            !this.closing &&
            !this.options.signal.aborted &&
            !this.hostLifetime.signal.aborted &&
            this.lease !== null,
        });
      }
      if (!this.host) {
        this.host = await AppWebCloudCopyHost.openInstallationDevice({
          signIn: this.flow!,
          installation: this.authority,
          release: this.options.release,
          origin: this.options.appOrigin,
          signal: this.hostLifetime.signal,
          loadRuntime: this.options.loadRuntime,
          allowLoopbackHttp: this.selection.allowLoopbackHttp,
        });
      }
      return this.flow!.view();
    });
  }

  attest(): Promise<AppInstallationSignInView> {
    return this.exclusive(async () => {
      if (!this.host)
        throw new Error("Confirm the selected account before device approval.");
      return this.host.attestInstallation();
    });
  }

  listApprovedCollections(): Promise<readonly AppInstallationCollection[]> {
    return this.exclusive(async () => {
      if (!this.host || !this.authority || this.flow!.view().state !== "paired")
        throw new Error(
          "Complete original device approval before choosing collections.",
        );
      return this.flow!.listApprovedCollections(this.authority);
    });
  }

  /** Explicit creation through the original native device. Public target state
   * is durable before bootstrap; unknown recovery restores that SAME target and
   * protected SDK outcome, never a replacement collection or native actor. */
  createCloudCopyCollection(reconcile = false): Promise<NextCreatedCollection> {
    return this.exclusive(async () => {
      if (
        (!this.host && !reconcile) ||
        this.collectionAttempted ||
        !this.authority ||
        this.flow!.view().state !== "paired" ||
        this.flow!.view().createCollections !== true
      )
        throw Object.assign(
          new Error("Collection creation needs explicit approval."),
          { reason: "refused" },
        );
      const signal = this.hostLifetime.signal;
      let intent = await collectionCreateIntent(
        this.authority.scope,
        signal,
        reconcile ? "resume" : "prepare",
        { requireModelVerified: true },
      );
      this.check();
      if (intent.phase === "completed")
        return {
          kind: "created-collection",
          collectionId: intent.collection,
          displayName: "New collection",
        };
      if (intent.phase === "attempted" && !reconcile)
        throw Object.assign(
          new Error("Explicit original creation recovery is required."),
          { reason: "outcome_unknown" },
        );
      const replacingCompleted =
        this.creationTarget !== null &&
        this.creationTarget !== intent.collection;
      if (replacingCompleted && !this.creationCompleted)
        throw Object.assign(new Error("Original collection binding changed."), {
          reason: "binding",
        });
      if (replacingCompleted) {
        // Native shutdown precedes releasing the completed collection's lease.
        await this.host?.close();
        this.host = null;
        this.check();
        await this.collectionLease?.release();
        this.collectionLease = null;
        this.creationCompleted = false;
      }
      const scope = Object.freeze({
        ...this.authority.scope,
        collection: intent.collection,
      });
      this.creationTarget = intent.collection;
      this.collectionLease ??= await acquireAppReplicaLease(
        this.options.locks,
        scope,
        signal,
      );
      this.check();
      const mode = intent.phase === "prepared" ? "fresh" : "existing";
      if (mode === "existing" || !this.host) {
        // Shutdown before reopening only the same protected native device.
        await this.host?.close();
        this.host = null;
        this.check();
        this.host = await AppWebCloudCopyHost.openInstallationDevice({
          signIn: this.flow!,
          installation: this.authority,
          release: this.options.release,
          origin: this.options.appOrigin,
          signal,
          loadRuntime: this.options.loadRuntime,
          allowLoopbackHttp: this.selection.allowLoopbackHttp,
        });
        this.check();
      }
      if (mode === "fresh") {
        intent = await collectionCreateIntent(
          this.authority.scope,
          signal,
          "attempt",
        );
        this.check();
      }
      if (!this.host)
        throw Object.assign(new Error("Original device is unavailable."), {
          reason: "recovery_required",
        });
      await this.host.bootstrapCloudCopy({
        scope,
        collectionCurrent: () =>
          !this.closing && !signal.aborted && this.collectionLease !== null,
        purpose: "create",
        outcomeMode: mode,
        signal,
        ...(mode === "existing"
          ? { reconcile: "explicit-unknown-outcome" as const }
          : {}),
        fetch: (input, init) => globalThis.fetch(input, init),
        allowLoopbackHttp: this.selection.allowLoopbackHttp,
      });
      this.check();
      await collectionCreateIntent(this.authority.scope, signal, "complete");
      this.check();
      this.creationCompleted = true;
      // Metadata completion is not collection READ or write readiness.
      return {
        kind: "created-collection",
        collectionId: intent.collection,
        displayName: "New collection",
      };
    });
  }

  startCollectionConsent(
    requestedCreateCollections = false,
  ): Promise<AppInstallationCollectionConsentView> {
    return this.exclusive(async () => {
      if (!this.authority || !this.host)
        throw new Error("Original installation is not ready.");
      return this.flow!.startCollectionConsent(
        this.authority,
        requestedCreateCollections,
      );
    });
  }

  exchangeCollectionConsent(): Promise<AppInstallationCollectionConsentView> {
    return this.exclusive(async () => {
      if (!this.authority || !this.host)
        throw new Error("Original installation is not ready.");
      return this.flow!.exchangeCollectionConsent(this.authority);
    });
  }

  /** One selected approved collection on the original device and Worker. */
  openApprovedCollection(collectionId: string): Promise<{
    scope: Readonly<{
      account: string;
      installation: string;
      collection: string;
    }>;
    displayName: string;
    requiresTaskNotesModelSetup: boolean;
    channel: MessagePort;
  }> {
    return this.exclusive(async () => {
      if (
        !this.host ||
        !this.authority ||
        this.flow!.view().state !== "paired" ||
        this.collectionAttempted
      )
        throw new Error("Original collection runtime is unavailable.");
      const approved = await this.flow!.listApprovedCollections(this.authority);
      this.check();
      const selected = approved.filter(
        (item) => item.collectionId === collectionId,
      );
      if (selected.length !== 1)
        throw new Error("Choose one approved collection.");
      const signal = this.hostLifetime.signal;
      const creation = await findCollectionCreation(
        this.authority.scope,
        collectionId,
        signal,
      );
      this.check();
      if (creation?.phase === "prepared")
        throw Object.assign(
          new Error("Resume the original creation before opening it."),
          { reason: "outcome_unknown" },
        );
      const continuingCreated =
        this.creationTarget === collectionId && this.creationCompleted;
      if (this.creationTarget !== null && !continuingCreated) {
        if (this.creationTarget !== collectionId && !this.creationCompleted)
          throw Object.assign(
            new Error("Reconcile the original creation first."),
            { reason: "outcome_unknown" },
          );
        await this.host.close();
        this.check();
        if (this.creationTarget !== collectionId) {
          await this.collectionLease?.release();
          this.collectionLease = null;
        }
        this.host = await AppWebCloudCopyHost.openInstallationDevice({
          signIn: this.flow!,
          installation: this.authority,
          release: this.options.release,
          origin: this.options.appOrigin,
          signal,
          loadRuntime: this.options.loadRuntime,
          allowLoopbackHttp: this.selection.allowLoopbackHttp,
        });
        this.check();
      }
      const scope = Object.freeze({
        ...this.authority.scope,
        collection: collectionId,
      });
      this.collectionLease ??= await acquireAppReplicaLease(
        this.options.locks,
        scope,
        signal,
      );
      this.check();
      this.collectionAttempted = true;
      const current = () =>
        !this.closing && !signal.aborted && this.collectionLease !== null;
      const host = this.host;
      if (!continuingCreated) {
        const mode = creation
          ? "existing"
          : await collectionJoinIntent(scope, signal, "prepare");
        this.check();
        await host.bootstrapCloudCopy({
          scope,
          collectionCurrent: current,
          purpose: creation ? "create" : "join",
          outcomeMode: mode,
          signal,
          ...(mode === "existing"
            ? { reconcile: "explicit-unknown-outcome" as const }
            : {}),
          fetch: (input, init) => globalThis.fetch(input, init),
          allowLoopbackHttp: this.selection.allowLoopbackHttp,
        });
        this.check();
        if (!creation) await collectionJoinIntent(scope, signal, "complete");
        else if (creation.phase === "attempted")
          await collectionCreateIntent(
            this.authority.scope,
            signal,
            "complete",
          );
        this.check();
      }
      const receipt = host.registeredReceipt();
      await host.openCollectionSql({
        signal: this.hostLifetime.signal,
        replicaId: receipt.deviceId,
        endpoint: 0,
        openSql: openNextCollectionSql,
      });
      this.check();
      await host.startCollectionLog({
        signal: this.hostLifetime.signal,
        fetch: (input, init) => globalThis.fetch(input, init),
      });
      await host.waitForVerifiedRead({ signal: this.hostLifetime.signal });
      this.check();
      const channel = new MessageChannel();
      try {
        host.attachDataFacade(channel.port1);
      } catch (error) {
        channel.port1.close();
        channel.port2.close();
        throw error;
      }
      this.facadeAttached = true;
      this.modelSetupStore = new NextModelSetupIntentStore({
        scope,
        appOrigin: this.options.appOrigin,
        cpOrigin: this.selection.cpOrigin,
        isCurrent: () => {
          this.check();
          host.registeredReceipt();
          return (
            this.host === host &&
            this.facadeAttached &&
            this.collectionLease !== null
          );
        },
      });
      this.scheduleDrive();
      return {
        scope,
        displayName: selected[0]!.displayName,
        requiresTaskNotesModelSetup:
          creation !== null && creation.modelVerified !== true,
        channel: channel.port2,
      };
    });
  }

  /** Fixed public definition-intent control, only inside the original verified
   * collection owner. This neither submits writes nor grants model authority. */
  modelSetupIntent(
    command: Extract<
      NextInstallationCommand,
      { kind: "model-setup-intent" | "model-resource-setup-intent" }
    >,
  ): Promise<ModelSetupIntent | null> {
    return this.exclusive(async () => {
      const store = this.modelSetupStore;
      if (!this.facadeAttached || !store)
        throw Object.assign(
          new Error("Original model setup owner unavailable."),
          { reason: "fenced" },
        );
      const signal = this.hostLifetime.signal;
      switch (command.action) {
        case "load":
          return store.load(signal);
        case "prepare":
          return command.kind === "model-resource-setup-intent"
            ? store.prepareResources(command.plan, signal)
            : store.prepare(command.plan, signal);
        case "attempt":
          return command.kind === "model-resource-setup-intent"
            ? store.recordResourceAttempt(command.mutationId, signal)
            : store.recordAttempt(command.mutationId, signal);
        case "confirm":
          return command.kind === "model-resource-setup-intent"
            ? store.recordResourceConfirmed(command.mutationId, signal)
            : store.recordConfirmed(command.mutationId, signal);
        case "verify":
          return command.kind === "model-resource-setup-intent"
            ? store.recordResourceVerified(command.mutationId, signal)
            : store.recordVerified(command.mutationId, signal);
      }
    });
  }

  /** Called only by the original model service after confirmed native source
   * readback (or a read-only already-valid model). This public flow marker is
   * not model/receipt authority; it only permits a later explicit new create. */
  finishModelSetup(): Promise<void> {
    return this.exclusive(async () => {
      const store = this.modelSetupStore;
      if (
        !store ||
        !this.host ||
        !this.authority ||
        !this.facadeAttached ||
        !this.collectionLease
      )
        throw Object.assign(
          new Error("Original model setup owner unavailable."),
          { reason: "fenced" },
        );
      this.host.registeredReceipt();
      const scope = store.scope;
      const creation = await findCollectionCreation(
        this.authority.scope,
        scope.collection,
        this.hostLifetime.signal,
      );
      this.check();
      if (!creation || creation.modelVerified === true) return;
      if (creation.phase !== "completed")
        throw Object.assign(
          new Error("Original genesis confirmation required."),
          { reason: "outcome_unknown" },
        );
      await collectionCreateIntent(
        this.authority.scope,
        this.hostLifetime.signal,
        "model-verified",
        { expectedCollection: scope.collection },
      );
      this.check();
    });
  }

  /** Foreground control belongs only to the installation owner, not the data
   * facade. Pausing does not release keys, ownership or unknown mutations. */
  setForeground(active: boolean): void {
    this.check();
    this.foreground = active;
    if (this.driveTimer !== null) clearTimeout(this.driveTimer);
    this.driveTimer = null;
    if (active) this.scheduleDrive();
  }
  private scheduleDrive(): void {
    if (
      this.closing ||
      !this.foreground ||
      !this.host ||
      !this.facadeAttached ||
      this.driveTimer !== null
    )
      return;
    this.driveTimer = setTimeout(() => {
      this.driveTimer = null;
      if (this.closing || !this.foreground || !this.host || this.driving)
        return;
      const host = this.host;
      const work = Promise.resolve().then(() =>
        host.driveCollection({ signal: this.hostLifetime.signal }),
      );
      this.driving = work;
      void work.then(
        () => {
          if (this.driving === work) this.driving = null;
          this.scheduleDrive();
        },
        () => {
          if (this.driving === work) this.driving = null;
          this.foreground = false;
        },
      );
    }, 250);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const pending = this.pending;
    const driving = this.driving;
    if (this.driveTimer !== null) clearTimeout(this.driveTimer);
    this.driveTimer = null;
    this.options.signal.removeEventListener("abort", this.onAbort);
    this.closing = Promise.resolve().then(async () => {
      // Drain acquisition/IO so no resource can arrive after cleanup/unlock.
      await pending?.catch(() => {});
      await driving?.catch(() => {});
      // A failed native shutdown retains ownership until Worker fail-stop.
      this.modelSetupStore?.close();
      this.modelSetupStore = null;
      await this.host?.close();
      this.host = null;
      await this.flow?.close();
      this.flowLifetime.abort();
      this.flow = null;
      this.authority = null;
      await this.collectionLease?.release();
      this.collectionLease = null;
      await this.lease?.release();
      this.lease = null;
    });
    this.hostLifetime.abort();
    return this.closing;
  }
}
