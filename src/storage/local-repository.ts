import { connect, type Connector, type MdbaseClient } from "@mdbase-dev/sdk";
import { NextTaskRepository } from "./next-repository";

/** A first-party Worker host transferred to this factory, never a shared daemon
 * or remote grant provider. Its producer owns installation/collection leases,
 * protected identity, WASM and OPFS. No keys/SQL/bootstrap enter the repository.
 */
export interface TaskNotesLocalHost {
  readonly scope: {
    readonly account: string;
    readonly installation: string;
    readonly collection: string;
  };
  readonly connector: Connector;
  isCurrent(): boolean;
  /** MUST wait for existing NATIVE trust/applied/key/rebuild read gates. A link,
   * Hello, synced/pending=0 or SQL open is NOT a readable collection proof. */
  waitForVerifiedRead(signal?: AbortSignal): Promise<void>;
  /** Close UI data connectors, drain or terminate Worker BEFORE lease release.
   * Retain ownership on failed termination; no reset or fallback. */
  close(): Promise<void>;
}

export class LocalRepositoryOpenError extends Error {
  constructor(
    readonly reason: "binding" | "aborted" | "unavailable" | "shutdown_failed",
  ) {
    super(
      `Local collection opening failed: ${reason}. Preserve its storage and reopen.`,
    );
    this.name = "LocalRepositoryOpenError";
  }
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

/** Provider-neutral native repository; disposal immediately fences data while
 * asynchronous Worker shutdown retains its leases. Call whenDisposed() when a
 * caller needs completion/error evidence, not just React's synchronous cleanup.
 */
class LocalTaskRepository extends NextTaskRepository {
  private closing: Promise<void> | undefined;
  constructor(
    client: MdbaseClient,
    name: string,
    account: string,
    private readonly closeHost: () => Promise<void>,
  ) {
    super(client, name, account);
  }
  override dispose(): void {
    if (this.closing) return;
    // Pin the cleanup promise first so recursive/concurrent disposal is one-shot.
    this.closing = Promise.resolve()
      .then(() => this.closeHost())
      .catch(() => {
        throw new LocalRepositoryOpenError("shutdown_failed");
      });
    void this.closing.catch(() => {
      /* whenDisposed observes failure; leases stay held */
    });
    super.dispose();
  }
  async whenDisposed(): Promise<void> {
    this.dispose();
    await this.closing;
  }
}

export type { LocalTaskRepository };

function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(new LocalRepositoryOpenError("aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new LocalRepositoryOpenError("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    void work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** Dormant until the genuine local-host producer is qualified. Takes ownership
 * on entry, including abort/refusal. No legacy application.start/setup, remote
 * provider fallback, or indexed task copy. Repository construction does NOT
 * infer readiness from the local SDK handshake/status.
 */
export async function openLocalTaskRepository(
  host: TaskNotesLocalHost,
  displayName: string,
  options: { signal?: AbortSignal } = {},
): Promise<LocalTaskRepository> {
  const scope = Object.freeze({
    account: host.scope.account,
    installation: host.scope.installation,
    collection: host.scope.collection,
  });
  const current = host.isCurrent.bind(host);
  const readable = host.waitForVerifiedRead.bind(host);
  const closeHost = host.close.bind(host);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= Promise.resolve().then(closeHost));
  const connector = host.connector;
  const signal = options.signal;
  let client: MdbaseClient | undefined;
  let repository: LocalTaskRepository | undefined;
  const check = () => {
    if (signal?.aborted) throw new LocalRepositoryOpenError("aborted");
    const ids = [scope.account, scope.installation, scope.collection];
    if (
      ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      current() !== true ||
      host.scope.account !== scope.account ||
      host.scope.installation !== scope.installation ||
      host.scope.collection !== scope.collection
    ) {
      throw new LocalRepositoryOpenError("binding");
    }
  };
  try {
    check();
    await cancellable(readable(signal), signal);
    check();
    client = await connect({
      connector,
      app: { name: "TaskNotes", version: "local-host" },
      reconnect: false,
      signal,
    });
    check();
    if (client.collection.toLowerCase() !== scope.collection.toLowerCase())
      throw new LocalRepositoryOpenError("binding");
    repository = new LocalTaskRepository(
      client,
      displayName,
      scope.account,
      close,
    );
    check();
    return repository;
  } catch (error) {
    try {
      if (repository) repository.dispose();
      else client?.close();
    } catch {
      // A failed data-port close still requires the host's drain/fail-stop below.
      // It is not rollback or permission to release ownership early.
    }
    try {
      await close();
    } catch {
      throw new LocalRepositoryOpenError("shutdown_failed");
    }
    throw error instanceof LocalRepositoryOpenError
      ? error
      : new LocalRepositoryOpenError("unavailable");
  }
}
