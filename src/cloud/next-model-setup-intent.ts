import type {
  ModelDefinitionOps,
  ModelSetupIntent,
  ModelSetupJournal,
  ModelSetupScope,
} from "../application/ports/model-setup";

const database = "tasknotes.native-model-setup.v1";
const records = "original-model-operation";
const phases = ["prepared", "attempted", "confirmed", "verified"] as const;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const maxBytes = 512 * 1024;
const encoder = new TextEncoder();
interface Stored {
  version: 1;
  revision: number;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}
export class NextModelSetupStorageError extends Error {
  constructor(
    readonly reason:
      "binding" | "fenced" | "recovery_required" | "outcome_unknown",
  ) {
    super("Preserve the original TaskNotes model setup operation.");
  }
}
function fail(reason: NextModelSetupStorageError["reason"]): never {
  throw new NextModelSetupStorageError(reason);
}
function exact(value: object, keys: string) {
  return Object.keys(value).sort().join() === keys;
}
function scopeCopy(scope: ModelSetupScope): ModelSetupScope {
  if (
    !scope ||
    !exact(scope, "account,collection,installation") ||
    Object.values(scope).some(
      (value) =>
        typeof value !== "string" ||
        !uuid.test(value) ||
        value === "00000000-0000-0000-0000-000000000000",
    )
  )
    fail("binding");
  return Object.freeze({
    account: scope.account,
    installation: scope.installation,
    collection: scope.collection,
  });
}
/** Bounded immutable definition intent, not arbitrary application storage. */
export function modelDefinitionOps(value: unknown): ModelDefinitionOps {
  if (!Array.isArray(value) || value.length !== 2) fail("binding");
  const ops = value.map((op) => {
    if (
      !op ||
      typeof op !== "object" ||
      !exact(op, "doc,kind,mustNotExist,path") ||
      op.kind !== "resource_put" ||
      op.mustNotExist !== true ||
      typeof op.path !== "string" ||
      typeof op.doc !== "string" ||
      !op.doc.length ||
      op.path.length > 1024 ||
      !op.path.endsWith(".md") ||
      op.path.startsWith("/") ||
      /[\\\u0000-\u001f\u007f]/.test(op.path) ||
      op.path
        .split("/")
        .some((part: string) => !part || part === "." || part === "..")
    )
      fail("binding");
    return Object.freeze({
      kind: "resource_put" as const,
      path: op.path,
      doc: op.doc,
      mustNotExist: true as const,
    });
  });
  if (
    ops[0]!.path === ops[1]!.path ||
    encoder.encode(JSON.stringify(ops)).byteLength > maxBytes
  )
    fail("binding");
  return Object.freeze(ops) as unknown as ModelDefinitionOps;
}
export function decode(
  value: unknown,
  scope: ModelSetupScope,
): ModelSetupIntent {
  const v = value as ModelSetupIntent;
  if (
    !v ||
    typeof v !== "object" ||
    !exact(v, "mutationId,ops,phase,scope,version") ||
    v.version !== 1 ||
    typeof v.mutationId !== "string" ||
    !uuid.test(v.mutationId) ||
    v.mutationId === "00000000-0000-0000-0000-000000000000" ||
    !phases.includes(v.phase)
  )
    fail("recovery_required");
  const bound = scopeCopy(v.scope);
  if (JSON.stringify(bound) !== JSON.stringify(scope)) fail("binding");
  return Object.freeze({
    version: 1,
    scope: bound,
    mutationId: v.mutationId,
    ops: modelDefinitionOps(v.ops),
    phase: v.phase,
  });
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore(records);
    request.onerror = request.onblocked = () => {
      abandoned = true;
      reject(new NextModelSetupStorageError("recovery_required"));
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
  });
}

/** Fixed collection-owned origin ledger: one nonextractable AES handle and
 * authenticated ciphertext in a strict IDB CAS. Not an account KEK, generic KV,
 * XSS boundary, receipt authority, model readiness or collection Saved proof.
 * The installation owner supplies the actual tuple and lifetime, never the UI.
 */
export class NextModelSetupIntentStore implements ModelSetupJournal {
  readonly scope: ModelSetupScope;
  private readonly namespace: string;
  private readonly binding: string;
  private stopped = false;
  private busy = false;
  constructor(
    private readonly owner: Readonly<{
      scope: ModelSetupScope;
      appOrigin: string;
      cpOrigin: string;
      isCurrent(): boolean;
    }>,
  ) {
    this.scope = scopeCopy(owner.scope);
    const app = new URL(owner.appOrigin),
      cp = new URL(owner.cpOrigin);
    if (
      app.origin !== owner.appOrigin ||
      cp.origin !== owner.cpOrigin ||
      cp.protocol !== "https:"
    )
      fail("binding");
    this.namespace = JSON.stringify([
      owner.appOrigin,
      owner.cpOrigin,
      "tasknotes-web",
      this.scope.account,
      this.scope.installation,
      this.scope.collection,
    ]);
    this.binding = JSON.stringify(this.scope);
  }
  close(): void {
    this.stopped = true;
  }
  private check(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (
      this.stopped ||
      !this.owner.isCurrent() ||
      JSON.stringify(scopeCopy(this.owner.scope)) !== this.binding
    ) {
      this.stopped = true;
      fail("fenced");
    }
  }
  private async exclusive<T>(
    signal: AbortSignal,
    work: (db: IDBDatabase) => Promise<T>,
  ): Promise<T> {
    this.check(signal);
    if (this.busy) fail("fenced");
    this.busy = true;
    let db: IDBDatabase | undefined;
    try {
      db = await openDatabase();
      this.check(signal);
      const result = await work(db);
      this.check(signal);
      return result;
    } finally {
      db?.close();
      this.busy = false;
    }
  }
  private read(
    db: IDBDatabase,
    signal: AbortSignal,
  ): Promise<Stored | undefined> {
    this.check(signal);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(records, "readonly");
      const request = tx.objectStore(records).get(this.namespace);
      const abort = () => tx.abort();
      signal.addEventListener("abort", abort, { once: true });
      tx.onabort = tx.onerror = () => {
        signal.removeEventListener("abort", abort);
        reject(new NextModelSetupStorageError("recovery_required"));
      };
      tx.oncomplete = () => {
        signal.removeEventListener("abort", abort);
        resolve(request.result as Stored | undefined);
      };
    });
  }
  private aad(revision: number): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify([this.namespace, 1, revision]));
  }
  private async unwrap(
    stored: Stored | undefined,
    signal: AbortSignal,
  ): Promise<ModelSetupIntent | null> {
    this.check(signal);
    if (stored === undefined) return null;
    if (
      !stored ||
      !exact(stored, "ciphertext,iv,key,revision,version") ||
      stored.version !== 1 ||
      !Number.isSafeInteger(stored.revision) ||
      stored.revision < 1 ||
      !(stored.key instanceof CryptoKey) ||
      stored.key.extractable ||
      stored.key.type !== "secret" ||
      stored.key.algorithm.name !== "AES-GCM" ||
      !stored.key.usages.includes("encrypt") ||
      !stored.key.usages.includes("decrypt") ||
      !(stored.iv instanceof Uint8Array) ||
      stored.iv.byteLength !== 12 ||
      !(stored.ciphertext instanceof ArrayBuffer) ||
      stored.ciphertext.byteLength > maxBytes + 2048
    )
      fail("recovery_required");
    let plaintext: Uint8Array<ArrayBuffer> | undefined;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: stored.iv,
            additionalData: this.aad(stored.revision),
          },
          stored.key,
          stored.ciphertext,
        ),
      );
      this.check(signal);
      return decode(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        this.scope,
      );
    } catch (reason) {
      if (reason instanceof NextModelSetupStorageError || signal.aborted)
        throw reason;
      throw new NextModelSetupStorageError("recovery_required");
    } finally {
      plaintext?.fill(0);
    }
  }
  private async commit(
    db: IDBDatabase,
    before: Stored | undefined,
    value: ModelSetupIntent,
    signal: AbortSignal,
  ): Promise<ModelSetupIntent> {
    this.check(signal);
    const revision = (before?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) fail("fenced");
    const key =
      before?.key ??
      (await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(value));
    let ciphertext: ArrayBuffer;
    try {
      ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: this.aad(revision) },
        key,
        plaintext,
      );
    } finally {
      plaintext.fill(0);
    }
    this.check(signal);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(records, "readwrite", {
          durability: "strict",
        });
        const abort = () => tx.abort();
        signal.addEventListener("abort", abort, { once: true });
        tx.onerror = tx.onabort = () => {
          signal.removeEventListener("abort", abort);
          reject(new NextModelSetupStorageError("outcome_unknown"));
        };
        tx.oncomplete = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const store = tx.objectStore(records);
        const request = store.get(this.namespace);
        request.onsuccess = () => {
          try {
            this.check(signal);
            const current = request.result as Stored | undefined;
            if (
              (current === undefined) !== (before === undefined) ||
              (current && current.revision !== before?.revision)
            ) {
              tx.abort();
              return;
            }
            store.put(
              { version: 1, revision, key, iv, ciphertext } satisfies Stored,
              this.namespace,
            );
          } catch {
            tx.abort();
          }
        };
      });
    } catch (reason) {
      this.stopped = true;
      throw reason;
    }
    this.check(signal);
    return value;
  }
  load(signal: AbortSignal): Promise<ModelSetupIntent | null> {
    return this.exclusive(signal, async (db) =>
      this.unwrap(await this.read(db, signal), signal),
    );
  }
  prepare(
    ops: ModelDefinitionOps,
    signal: AbortSignal,
  ): Promise<ModelSetupIntent> {
    // Copy before the first await so caller mutation cannot alter the operation.
    const captured = modelDefinitionOps(ops);
    return this.exclusive(signal, async (db) => {
      const stored = await this.read(db, signal),
        existing = await this.unwrap(stored, signal);
      if (existing) {
        if (JSON.stringify(existing.ops) !== JSON.stringify(captured))
          fail("binding");
        return existing;
      }
      const intent = decode(
        {
          version: 1,
          scope: this.scope,
          mutationId: crypto.randomUUID(),
          ops: captured,
          phase: "prepared",
        },
        this.scope,
      );
      return this.commit(db, stored, intent, signal);
    });
  }
  private advance(
    id: string,
    phase: ModelSetupIntent["phase"],
    signal: AbortSignal,
  ): Promise<ModelSetupIntent> {
    return this.exclusive(signal, async (db) => {
      const stored = await this.read(db, signal),
        existing = await this.unwrap(stored, signal);
      if (!existing) fail("recovery_required");
      if (existing.mutationId !== id) fail("binding");
      const from = phases.indexOf(existing.phase),
        to = phases.indexOf(phase);
      if (to < from || to > from + 1) fail("recovery_required");
      if (to === from) return existing;
      return this.commit(
        db,
        stored,
        decode({ ...existing, phase }, this.scope),
        signal,
      );
    });
  }
  recordAttempt(id: string, signal: AbortSignal): Promise<ModelSetupIntent> {
    return this.advance(id, "attempted", signal);
  }
  recordConfirmed(id: string, signal: AbortSignal): Promise<ModelSetupIntent> {
    return this.advance(id, "confirmed", signal);
  }
  recordVerified(id: string, signal: AbortSignal): Promise<ModelSetupIntent> {
    return this.advance(id, "verified", signal);
  }
}
