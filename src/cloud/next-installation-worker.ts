import { connect } from "@mdbase-dev/sdk";
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
      this.repository = new NextTaskRepository(
        client,
        opened.displayName,
        opened.scope.account,
      );
      document.addEventListener("visibilitychange", this.onForeground);
      this.onForeground();
      return this.repository;
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
