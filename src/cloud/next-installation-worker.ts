import { connect } from "@mdbase-dev/sdk";
import type {
  ModelResourceSetupJournal,
  ModelResourceSetupIntent,
  ResourceSetupIntent,
  ModelSetupScope,
  ModelSetupIntent,
  ModelPackSetupIntent,
} from "../application/ports/model-setup";
import {
  decode as decodeModelSetupIntent,
  modelPackPlan,
  modelResourcePlan,
} from "./next-model-setup-intent";
import {
  appLocalConnector,
  selectAppEnvironment,
  type AppWebSignInSnapshot,
  type AppWebSignInPortal,
} from "@mdbase-dev/sdk/app-host";
import { isNextSignInSnapshot } from "./next-sign-in-snapshot";
import { NextTaskRepository } from "../storage/next-repository";
import type {
  AppInstallationSignInView,
  AppInstallationCollection,
  AppInstallationCollectionConsentView,
} from "@mdbase-dev/sdk/app-host";
import { isInstallationErrorCode } from "./next-installation-protocol";
import type {
  NextInstallationBuildInput,
  NextInstallationCommand,
  NextInstallationRequest,
  NextInstallationResponse,
  NextInstallationResult,
  NextOpenedCollection,
  NextCreatedCollection,
} from "./next-installation-protocol";

/** One owned Worker and one original in-flight operation. No automatic retry or
 * restart. Error delivery is code-only, never SDK/HTTP response bodies. */
export class NextInstallationWorker {
  private nextId = 1;
  private snapshot: AppWebSignInSnapshot | null = null;
  private readonly snapshotListeners = new Set<() => void>();
  private portal: AppWebSignInPortal | null = null;
  private sessionClosed = false;
  private closeWaiter: { resolve(): void; reject(error: Error): void } | null =
    null;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  };
  closePortal(): void {
    this.portal?.close();
    this.portal = null;
  }
  reservePortal(open: () => AppWebSignInPortal): void {
    this.closePortal();
    this.portal = open();
  }
  private receiveSnapshot(snapshot: AppWebSignInSnapshot) {
    this.snapshot = snapshot;
    // A paired account can still be approving ADDITIONAL collection consent.
    // Close only after that genuine receipt has advanced out of authorizing.
    if (
      (snapshot.signIn?.state === "paired" &&
        ["unselected", "opening", "setup_required", "ready"].includes(
          snapshot.status,
        )) ||
      snapshot.status === "closed" ||
      snapshot.status === "blocked"
    ) {
      this.portal?.close();
      this.portal = null;
    }
    for (const listener of this.snapshotListeners) listener();
  }
  private protectedSlotOpened = false;
  private readonly onAbort = () => {
    if (!this.protectedSlotOpened) this.onError();
    else void this.close().catch(() => {});
  };
  private stopped = false;
  private dataConnector: ReturnType<typeof appLocalConnector> | null = null;
  private repository: NextTaskRepository | null = null;
  private modelJournal: ModelResourceSetupJournal | null = null;
  private closing: Promise<void> | null = null;
  private readonly onForeground = () => {
    void this.syncForeground().catch(() => {});
  };
  private async syncForeground(): Promise<void> {
    await this.pending?.promise.catch(() => {});
    if (this.stopped || this.closing || this.signal?.aborted) return;
    await this.call({
      kind: "set-foreground",
      active: document.visibilityState !== "hidden",
    });
  }
  private pending: {
    id: number;
    resolve(value: NextInstallationResult): void;
    reject(error: Error): void;
    promise: Promise<NextInstallationResult>;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private constructor(
    private readonly worker: Worker,
    private readonly signal?: AbortSignal,
    private readonly sessionCpOrigin: string | null = null,
  ) {
    signal?.addEventListener("abort", this.onAbort, { once: true });
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
    worker.addEventListener("messageerror", this.onError);
  }
  static async open(
    build: NextInstallationBuildInput,
    mode: "fresh" | "existing",
    requestedCreateCollections?: boolean,
    signal?: AbortSignal,
  ): Promise<{
    worker: NextInstallationWorker;
    view: AppInstallationSignInView;
  }> {
    signal?.throwIfAborted();
    const worker = new NextInstallationWorker(
      new Worker(new URL("./next-installation.worker.ts", import.meta.url), {
        type: "module",
      }),
      signal,
    );
    try {
      const view = (await worker.call({
        kind: "open",
        build,
        mode,
        ...(requestedCreateCollections === undefined
          ? {}
          : { requestedCreateCollections }),
      })) as AppInstallationSignInView;
      signal?.throwIfAborted();
      worker.protectedSlotOpened = true;
      return { worker, view };
    } catch (error) {
      worker.failStop();
      throw error;
    }
  }
  static async openSession(
    build: NextInstallationBuildInput,
    signal?: AbortSignal,
  ): Promise<NextInstallationWorker> {
    signal?.throwIfAborted();
    const environment = selectAppEnvironment({
      environment: build.environment,
      appOrigin: build.appOrigin,
      release: build.release,
    });
    const worker = new NextInstallationWorker(
      new Worker(new URL("./next-sign-in.worker.ts", import.meta.url), {
        type: "module",
      }),
      signal,
      environment.cpOrigin,
    );
    try {
      await worker.sessionCall({ kind: "session-open", build });
      signal?.throwIfAborted();
      worker.protectedSlotOpened = true;
      document.addEventListener("visibilitychange", worker.onForeground);
      return worker;
    } catch (error) {
      worker.failStop();
      throw error;
    }
  }
  private async sessionCall(
    command: NextInstallationCommand,
  ): Promise<AppWebSignInSnapshot> {
    const result = await this.call(command);
    if (
      !result ||
      Array.isArray(result) ||
      !("kind" in result) ||
      result.kind !== "session" ||
      !this.sessionCpOrigin ||
      !isNextSignInSnapshot(result.snapshot, this.sessionCpOrigin)
    ) {
      this.onError();
      throw Error("TaskNotes sign-in response unavailable.");
    }
    if (this.closing || this.stopped || this.signal?.aborted)
      throw Error("TaskNotes sign-in owner closed.");
    this.receiveSnapshot(result.snapshot);
    return result.snapshot;
  }
  startSession() {
    return this.sessionCall({ kind: "session-start" });
  }
  authorizeSession() {
    return this.sessionCall({ kind: "session-authorize" });
  }
  renewSession() {
    return this.sessionCall({ kind: "session-renew" });
  }
  selectSession(collectionId: string) {
    return this.sessionCall({ kind: "session-select", collectionId });
  }
  private readonly onMessage = (
    event: MessageEvent<NextInstallationResponse | Record<string, unknown>>,
  ) => {
    const pushed = event.data;
    if (this.sessionCpOrigin && pushed && "event" in pushed) {
      if (pushed.version !== 1) {
        this.onError();
        return;
      }
      switch (pushed.event) {
        case "session-snapshot":
          if (
            Object.keys(pushed).sort().join() !== "event,snapshot,version" ||
            !isNextSignInSnapshot(pushed.snapshot, this.sessionCpOrigin)
          ) {
            this.onError();
            return;
          }
          if (!this.closing && !this.stopped)
            this.receiveSnapshot(pushed.snapshot);
          return;
        case "portal-navigate": {
          if (
            Object.keys(pushed).sort().join() !== "event,uri,version" ||
            typeof pushed.uri !== "string"
          ) {
            this.onError();
            return;
          }
          try {
            const uri = new URL(pushed.uri);
            if (
              uri.origin !== this.sessionCpOrigin ||
              uri.username ||
              uri.password
            )
              throw Error("portal binding");
            this.portal?.navigate(uri.href);
          } catch {
            this.onError();
          }
          return;
        }
        case "portal-close":
          if (Object.keys(pushed).sort().join() !== "event,version") {
            this.onError();
            return;
          }
          this.portal?.close();
          this.portal = null;
          return;
        case "session-closed":
          if (
            Object.keys(pushed).sort().join() !== "event,ok,version" ||
            typeof pushed.ok !== "boolean"
          ) {
            this.onError();
            return;
          }
          if (pushed.ok) {
            this.sessionClosed = true;
            this.closeWaiter?.resolve();
          } else
            this.closeWaiter?.reject(
              Error("TaskNotes owner shutdown could not be confirmed."),
            );
          return;
        default:
          this.onError();
          return;
      }
    }
    const response = event.data as NextInstallationResponse,
      pending = this.pending;
    if (
      !pending ||
      !response ||
      response.version !== 1 ||
      response.id !== pending.id ||
      typeof response.ok !== "boolean"
    ) {
      this.onError();
      return;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else if (isInstallationErrorCode(response.reason))
      pending.reject(new Error(`TaskNotes native sign-in: ${response.reason}`));
    else {
      pending.reject(new Error("TaskNotes native sign-in unavailable."));
      this.failStop();
    }
  };
  private readonly onError = () => {
    this.pending?.reject(
      new Error(
        "TaskNotes native Worker stopped; preserve storage and resume the original installation.",
      ),
    );
    if (this.sessionCpOrigin && this.protectedSlotOpened) {
      void this.close().catch(() => {});
      return;
    }
    this.failStop();
  };
  private failStop(): void {
    if (this.stopped && !this.sessionClosed) return;
    if (
      this.sessionCpOrigin &&
      this.protectedSlotOpened &&
      !this.sessionClosed
    ) {
      // Quarantine the original Worker/resources on failed or unknown stop.
      // Do not discard native/SQL/leases or an original pending result reader.
      this.stopped = true;
      document.removeEventListener("visibilitychange", this.onForeground);
      return;
    }
    this.stopped = true;
    this.signal?.removeEventListener("abort", this.onAbort);
    document.removeEventListener("visibilitychange", this.onForeground);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.dataConnector?.close();
    this.repository?.dispose();
    this.dataConnector = null;
    this.repository = null;
    this.modelJournal = null;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onError);
    this.worker.terminate();
  }
  private call(
    command: NextInstallationCommand,
  ): Promise<NextInstallationResult> {
    if (
      this.stopped ||
      ((this.closing || this.signal?.aborted) && command.kind !== "close") ||
      this.nextId > 0xffffffff
    )
      return Promise.reject(new Error("TaskNotes native Worker is closed."));
    if (this.pending)
      return Promise.reject(new Error("TaskNotes native sign-in is busy."));
    const id = this.nextId++;
    let resolve!: (value: NextInstallationResult) => void,
      reject!: (error: Error) => void;
    const promise = new Promise<NextInstallationResult>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    const timer = setTimeout(
      () => {
        reject(
          new Error(
            "TaskNotes native outcome unknown; preserve storage and resume the original installation.",
          ),
        );
        if (this.sessionCpOrigin) this.onError();
        else this.failStop();
      },
      this.sessionCpOrigin ? 120_000 : 30_000,
    );
    this.pending = { id, resolve, reject, promise, timer };
    try {
      this.worker.postMessage({
        version: 1,
        id,
        command,
      } satisfies NextInstallationRequest);
    } catch {
      this.onError();
    }
    return promise;
  }
  start(): Promise<AppInstallationSignInView> {
    return this.call({ kind: "start" }) as Promise<AppInstallationSignInView>;
  }
  renewExpiredPairing(): Promise<AppInstallationSignInView> {
    return this.call({
      kind: "renew-expired",
    }) as Promise<AppInstallationSignInView>;
  }
  exchange(): Promise<AppInstallationSignInView> {
    return this.call({
      kind: "exchange",
    }) as Promise<AppInstallationSignInView>;
  }
  confirmAccount(accountId: string): Promise<AppInstallationSignInView> {
    return this.call({
      kind: "confirm-account",
      accountId,
    }) as Promise<AppInstallationSignInView>;
  }
  attest(): Promise<AppInstallationSignInView> {
    return this.call({ kind: "attest" }) as Promise<AppInstallationSignInView>;
  }
  collections(): Promise<readonly AppInstallationCollection[]> {
    return this.call({ kind: "collections" }) as Promise<
      readonly AppInstallationCollection[]
    >;
  }
  createCollection(reconcile = false): Promise<NextCreatedCollection> {
    return this.call({
      kind: "create-collection",
      reconcile,
    }) as Promise<NextCreatedCollection>;
  }
  startConsent(
    requestedCreateCollections = false,
  ): Promise<AppInstallationCollectionConsentView> {
    return this.call({
      kind: "start-consent",
      requestedCreateCollections,
    }) as Promise<AppInstallationCollectionConsentView>;
  }
  exchangeConsent(): Promise<AppInstallationCollectionConsentView> {
    return this.call({
      kind: "exchange-consent",
    }) as Promise<AppInstallationCollectionConsentView>;
  }
  /** Only the original held repository may receive this fixed journal wrapper;
   * no protected store/key handle is transferred from its owning Worker. */
  modelSetupJournal(): ModelResourceSetupJournal {
    if (
      !this.modelJournal ||
      this.stopped ||
      this.closing ||
      this.signal?.aborted
    )
      throw new Error("Original model setup owner unavailable.");
    return this.modelJournal;
  }
  private originalModelSetupJournal(
    scope: ModelSetupScope,
  ): ModelResourceSetupJournal {
    const bound = Object.freeze({
      account: scope.account,
      installation: scope.installation,
      collection: scope.collection,
    });
    const invoke = async (
      command: Extract<
        NextInstallationCommand,
        { kind: "model-setup-intent" | "model-resource-setup-intent" }
      >,
      signal: AbortSignal,
    ): Promise<ModelSetupIntent | null> => {
      signal.throwIfAborted();
      await this.pending?.promise;
      signal.throwIfAborted();
      const result = await this.call(command);
      signal.throwIfAborted();
      if (command.action === "load" && result === null) return null;
      let intent: ModelSetupIntent;
      try {
        intent = decodeModelSetupIntent(result, bound);
      } catch {
        this.onError();
        throw new Error("Original model setup binding unavailable.");
      }
      if (
        (command.action !== "load" &&
          (command.kind === "model-resource-setup-intent"
            ? intent.version !== 3 && intent.version !== 4
            : intent.version !== 2)) ||
        (command.action === "prepare-round" &&
          (intent.version !== 4 ||
            intent.previous.mutationId !== command.previousMutationId)) ||
        ("mutationId" in command && intent.mutationId !== command.mutationId) ||
        ((command.action === "prepare" || command.action === "prepare-round") &&
          (intent.version === 1 ||
            JSON.stringify(intent.plan) !== JSON.stringify(command.plan)))
      ) {
        this.onError();
        throw new Error("Original model setup binding unavailable.");
      }
      return intent;
    };
    const mutate = async (
      command: Extract<NextInstallationCommand, { kind: "model-setup-intent" }>,
      signal: AbortSignal,
    ): Promise<ModelPackSetupIntent> => {
      const intent = await invoke(command, signal);
      if (!intent || intent.version !== 2) {
        this.onError();
        throw new Error("Original model setup binding unavailable.");
      }
      return intent;
    };
    const mutateResources = async (
      command: Extract<
        NextInstallationCommand,
        { kind: "model-resource-setup-intent" }
      >,
      signal: AbortSignal,
    ): Promise<ResourceSetupIntent> => {
      const intent = await invoke(command, signal);
      if (!intent || (intent.version !== 3 && intent.version !== 4)) {
        this.onError();
        throw new Error("Original resource setup binding unavailable.");
      }
      return intent;
    };
    return Object.freeze({
      scope: bound,
      load: (signal: AbortSignal) =>
        invoke({ kind: "model-setup-intent", action: "load" }, signal),
      prepare: async (plan, signal) => {
        const captured = modelPackPlan(plan);
        return mutate(
          { kind: "model-setup-intent", action: "prepare", plan: captured },
          signal,
        );
      },
      recordAttempt: async (mutationId, signal) =>
        mutate(
          { kind: "model-setup-intent", action: "attempt", mutationId },
          signal,
        ),
      recordConfirmed: async (mutationId, signal) =>
        mutate(
          { kind: "model-setup-intent", action: "confirm", mutationId },
          signal,
        ),
      recordVerified: async (mutationId, signal) =>
        mutate(
          { kind: "model-setup-intent", action: "verify", mutationId },
          signal,
        ),
      prepareResources: async (
        plan,
        signal,
      ): Promise<ModelResourceSetupIntent> => {
        const intent = await mutateResources(
          {
            kind: "model-resource-setup-intent",
            action: "prepare",
            plan: modelResourcePlan(plan),
          },
          signal,
        );
        if (intent.version !== 3)
          throw new Error("Original resource setup version unavailable.");
        return intent;
      },
      prepareResourceRound: async (plan, previousMutationId, signal) => {
        const intent = await mutateResources(
          {
            kind: "model-resource-setup-intent",
            action: "prepare-round",
            plan: modelResourcePlan(plan),
            previousMutationId,
          },
          signal,
        );
        if (intent.version !== 4)
          throw new Error("Original resource setup round unavailable.");
        return intent;
      },
      recordResourceAttempt: async (mutationId, signal) =>
        mutateResources(
          {
            kind: "model-resource-setup-intent",
            action: "attempt",
            mutationId,
          },
          signal,
        ),
      recordResourceConfirmed: async (mutationId, signal) =>
        mutateResources(
          {
            kind: "model-resource-setup-intent",
            action: "confirm",
            mutationId,
          },
          signal,
        ),
      recordResourceVerified: async (mutationId, signal) =>
        mutateResources(
          { kind: "model-resource-setup-intent", action: "verify", mutationId },
          signal,
        ),
    } satisfies ModelResourceSetupJournal);
  }
  async openCollection(collectionId: string): Promise<NextTaskRepository> {
    if (this.dataConnector || this.repository)
      throw new Error("Original collection already opened.");
    const result = await this.call({
      kind: this.sessionCpOrigin ? "session-connection" : "open-collection",
      collectionId,
    });
    const opened = result as NextOpenedCollection;
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (
      !opened ||
      opened.kind !== "collection" ||
      !opened.scope ||
      opened.scope.collection !== collectionId ||
      !uuid.test(opened.scope.account) ||
      !uuid.test(opened.scope.installation) ||
      typeof opened.displayName !== "string" ||
      typeof opened.requiresTaskNotesModelSetup !== "boolean" ||
      !(opened.channel instanceof MessagePort)
    ) {
      this.onError();
      throw new Error("Original collection binding unavailable.");
    }
    const connector = appLocalConnector(opened.channel, {
      ...opened.scope,
      isCurrent: () => !this.stopped && !this.closing && !this.signal?.aborted,
    });
    this.dataConnector = connector;
    try {
      const client = await connect({
        app: { name: "TaskNotes", version: "1" },
        connector,
        reconnect: false,
        ...(this.signal ? { signal: this.signal } : {}),
      });
      if (this.stopped || this.closing || this.signal?.aborted) {
        client.close();
        throw new Error("Original collection lifetime ended.");
      }
      this.modelJournal = this.originalModelSetupJournal(opened.scope);
      this.repository = new NextTaskRepository(
        client,
        opened.displayName,
        opened.scope.account,
        {
          modelSetupJournal: this.modelJournal,
          requiresTaskNotesModelSetup: opened.requiresTaskNotesModelSetup,
          onModelSetupVerified: async (signal) => {
            signal.throwIfAborted();
            await this.pending?.promise;
            signal.throwIfAborted();
            await this.call({ kind: "model-setup-verified" });
            signal.throwIfAborted();
          },
        },
      );
      const repository = this.repository;
      // Opening never installs or resumes, including original creator recovery.
      // The real controller flag keeps tasks/views behind the explicit setup
      // screen until that same controller acknowledges completion.
      if (
        this.stopped ||
        this.closing ||
        this.signal?.aborted ||
        this.repository !== repository
      ) {
        repository.dispose();
        throw new Error("Original collection lifetime ended.");
      }
      document.addEventListener("visibilitychange", this.onForeground);
      this.onForeground();
      return repository;
    } catch (error) {
      connector.close();
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.sessionCpOrigin && this.protectedSlotOpened) {
      return (this.closing ??= Promise.resolve().then(async () => {
        this.portal?.close();
        this.portal = null;
        try {
          await new Promise<void>((resolve, reject) => {
            this.closeWaiter = { resolve, reject };
            this.worker.postMessage({ version: 1, event: "session-close" });
          });
        } finally {
          this.failStop();
        }
      }));
    }
    return (this.closing ??= Promise.resolve().then(async () => {
      try {
        this.dataConnector?.close();
        this.repository?.dispose();
        await this.pending?.promise.catch(() => {});
        if (!this.stopped) await this.call({ kind: "close" });
      } finally {
        this.failStop();
      }
    }));
  }
}
