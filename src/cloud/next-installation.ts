import {
  AppProtectedInstallationSignIn,
  AppWebCloudCopyHost,
  acquireAppInstallationLease,
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

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const pending = this.pending;
    this.options.signal.removeEventListener("abort", this.onAbort);
    this.closing = Promise.resolve().then(async () => {
      // Drain acquisition/IO so no resource can arrive after cleanup/unlock.
      await pending?.catch(() => {});
      // A failed native shutdown retains ownership until Worker fail-stop.
      await this.host?.close();
      this.host = null;
      await this.flow?.close();
      this.flowLifetime.abort();
      this.flow = null;
      this.authority = null;
      await this.lease?.release();
      this.lease = null;
    });
    this.hostLifetime.abort();
    return this.closing;
  }
}
