import { connect } from "@mdbase-dev/sdk";
import {
  ModelSetupError,
  type ModelSetupJournal,
  type ModelSetupScope,
  type ModelSetupIntent,
  type ModelPackSetupIntent,
} from "../application/ports/model-setup";
import {
  decode as decodeModelSetupIntent,
  modelPackPlan,
} from "./next-model-setup-intent";
import { appLocalConnector } from "@mdbase-dev/sdk/app-host";
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
  private protectedSlotOpened = false;
  private readonly onAbort = () => {
    if (!this.protectedSlotOpened) this.onError();
    else void this.close().catch(() => {});
  };
  private stopped = false;
  private dataConnector: ReturnType<typeof appLocalConnector> | null = null;
  private repository: NextTaskRepository | null = null;
  private modelJournal: ModelSetupJournal | null = null;
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
  private readonly onMessage = (
    event: MessageEvent<NextInstallationResponse>,
  ) => {
    const response = event.data,
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
    this.failStop();
  };
  private failStop(): void {
    if (this.stopped) return;
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
    const timer = setTimeout(() => {
      reject(
        new Error(
          "TaskNotes native outcome unknown; preserve storage and resume the original installation.",
        ),
      );
      this.failStop();
    }, 30_000);
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
  modelSetupJournal(): ModelSetupJournal {
    if (
      !this.modelJournal ||
      this.stopped ||
      this.closing ||
      this.signal?.aborted
    )
      throw new Error("Original model setup owner unavailable.");
    return this.modelJournal;
  }
  private originalModelSetupJournal(scope: ModelSetupScope): ModelSetupJournal {
    const bound = Object.freeze({
      account: scope.account,
      installation: scope.installation,
      collection: scope.collection,
    });
    const invoke = async (
      command: Extract<NextInstallationCommand, { kind: "model-setup-intent" }>,
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
        (command.action !== "load" && intent.version !== 2) ||
        ("mutationId" in command && intent.mutationId !== command.mutationId) ||
        (command.action === "prepare" &&
          intent.version === 2 &&
          JSON.stringify(intent.plan) !== JSON.stringify(command.plan))
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
    } satisfies ModelSetupJournal);
  }
  async openCollection(collectionId: string): Promise<NextTaskRepository> {
    if (this.dataConnector || this.repository)
      throw new Error("Original collection already opened.");
    const result = await this.call({ kind: "open-collection", collectionId });
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
          onModelSetupVerified: async () => {
            await this.pending?.promise;
            await this.call({ kind: "model-setup-verified" });
          },
        },
      );
      const repository = this.repository;
      // Original creation recovery includes model setup. No existing collection
      // is auto-configured; typed blocked/unknown states keep this held owner
      // available for the explicit setup/recovery UI rather than opening again.
      if (opened.requiresTaskNotesModelSetup) {
        const setup = repository.modelSetup!;
        try {
          const view = await setup.inspect();
          if (view.state === "outcome_unknown") await setup.resume();
          else if (view.state === "required" || view.state === "ready")
            await setup.install();
        } catch (reason) {
          if (!(reason instanceof ModelSetupError)) throw reason;
        }
      }
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
