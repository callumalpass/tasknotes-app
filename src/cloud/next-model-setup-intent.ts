import {
  MODEL_SETUP_LIMITS,
  type LegacyModelSetupIntent,
  type ModelPackOperation,
  type ModelPackPlan,
  type ModelPackSetupIntent,
  type ModelSetupIntent,
  type ModelSetupJournal,
  type ModelSetupScope,
} from "../application/ports/model-setup";

const database = "tasknotes.native-model-setup.v1";
const records = "original-model-operation";
const phases = ["prepared", "attempted", "confirmed", "verified"] as const;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const maxBytes = MODEL_SETUP_LIMITS.plaintextBytes;
const digest = /^sha256:[0-9a-f]{64}$/;
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
function unsafePathCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return value.includes("\\");
}
/** Original v1 decoder only. No legacy intent may be prepared or advanced. */
function legacyDefinitionOps(value: unknown): LegacyModelSetupIntent["ops"] {
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
      unsafePathCharacters(op.path) ||
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
  return Object.freeze(ops) as unknown as LegacyModelSetupIntent["ops"];
}
function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MODEL_SETUP_LIMITS.pathCodeUnits &&
    !value.startsWith("/") &&
    !unsafePathCharacters(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}
/** Copy the original ordered plan without rebuilding intent from file diffs. */
export function modelPackPlan(value: unknown): ModelPackPlan {
  const plan = value as ModelPackPlan;
  if (
    !plan ||
    typeof plan !== "object" ||
    !exact(plan, "assessmentDigest,ops,pack,readback") ||
    !plan.pack ||
    typeof plan.pack !== "object" ||
    !exact(plan.pack, "digest,id,version") ||
    typeof plan.pack.id !== "string" ||
    !plan.pack.id.length ||
    typeof plan.pack.version !== "string" ||
    !plan.pack.version.length ||
    typeof plan.pack.digest !== "string" ||
    !digest.test(plan.pack.digest) ||
    typeof plan.assessmentDigest !== "string" ||
    !digest.test(plan.assessmentDigest) ||
    !Array.isArray(plan.ops) ||
    !plan.ops.length ||
    plan.ops.length > MODEL_SETUP_LIMITS.operations ||
    !Array.isArray(plan.readback) ||
    !plan.readback.length ||
    plan.readback.length > MODEL_SETUP_LIMITS.readbacks
  )
    fail("binding");
  const ops = plan.ops.map((op): ModelPackOperation => {
    if (
      !op ||
      typeof op !== "object" ||
      !safePath(op.path) ||
      ("baseRevision" in op &&
        (typeof op.baseRevision !== "string" || !digest.test(op.baseRevision)))
    )
      fail("binding");
    const base = "baseRevision" in op ? { baseRevision: op.baseRevision! } : {};
    if (op.kind === "resource_put") {
      if (
        !exact(
          op,
          "baseRevision" in op
            ? "baseRevision,doc,kind,mustNotExist,path"
            : "doc,kind,mustNotExist,path",
        ) ||
        typeof op.doc !== "string" ||
        typeof op.mustNotExist !== "boolean"
      )
        fail("binding");
      return Object.freeze({
        kind: op.kind,
        path: op.path,
        doc: op.doc,
        ...base,
        mustNotExist: op.mustNotExist,
      });
    }
    if (
      op.kind !== "resource_delete" ||
      !exact(op, "baseRevision" in op ? "baseRevision,kind,path" : "kind,path")
    )
      fail("binding");
    return Object.freeze({ kind: op.kind, path: op.path, ...base });
  });
  const seen = new Set<string>();
  const readback = plan.readback.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !exact(entry, "doc,path") ||
      !safePath(entry.path) ||
      (entry.doc !== null && typeof entry.doc !== "string") ||
      seen.has(entry.path) ||
      (entry.doc === null &&
        !ops.some(
          (op) => op.kind === "resource_delete" && op.path === entry.path,
        ))
    )
      fail("binding");
    seen.add(entry.path);
    return Object.freeze({ path: entry.path, doc: entry.doc });
  });
  for (const op of ops) {
    const expected = readback.find((entry) => entry.path === op.path);
    if (
      !expected ||
      expected.doc !== (op.kind === "resource_put" ? op.doc : null)
    )
      fail("binding");
  }
  const captured = Object.freeze({
    pack: Object.freeze({
      id: plan.pack.id,
      version: plan.pack.version,
      digest: plan.pack.digest,
    }),
    assessmentDigest: plan.assessmentDigest,
    ops: Object.freeze(ops),
    readback: Object.freeze(readback),
  });
  if (encoder.encode(JSON.stringify(captured)).byteLength > maxBytes)
    fail("binding");
  return captured;
}
export function decode(
  value: unknown,
  scope: ModelSetupScope,
): ModelSetupIntent {
  const v = value as ModelSetupIntent;
  if (
    !v ||
    typeof v !== "object" ||
    (v.version !== 1 && v.version !== 2) ||
    !exact(
      v,
      v.version === 1
        ? "mutationId,ops,phase,scope,version"
        : "mutationId,phase,plan,scope,version",
    ) ||
    typeof v.mutationId !== "string" ||
    !uuid.test(v.mutationId) ||
    v.mutationId === "00000000-0000-0000-0000-000000000000" ||
    !phases.includes(v.phase)
  )
    fail("recovery_required");
  const bound = scopeCopy(v.scope);
  if (JSON.stringify(bound) !== JSON.stringify(scope)) fail("binding");
  if (v.version === 1)
    return Object.freeze({
      version: 1,
      scope: bound,
      mutationId: v.mutationId,
      ops: legacyDefinitionOps(v.ops),
      phase: v.phase,
    });
  const intent = Object.freeze({
    version: 2 as const,
    scope: bound,
    mutationId: v.mutationId,
    plan: modelPackPlan(v.plan),
    phase: v.phase,
  });
  // Reserve the longest phase spelling so a prepared plan can always advance.
  if (
    encoder.encode(JSON.stringify({ ...intent, phase: "confirmed" }))
      .byteLength > maxBytes
  )
    fail("binding");
  return intent;
}
function packIntent(value: ModelSetupIntent): ModelPackSetupIntent {
  if (value.version !== 2) fail("recovery_required");
  return value;
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
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
      if (
        (value as { version?: unknown } | null)?.version === 2 &&
        plaintext.byteLength > maxBytes
      )
        fail("recovery_required");
      return decode(value, this.scope);
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
    value: ModelPackSetupIntent,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
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
    if (plaintext.byteLength > maxBytes) {
      plaintext.fill(0);
      fail("binding");
    }
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
    plan: ModelPackPlan,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    // Copy before the first await so caller mutation cannot alter the operation.
    const captured = modelPackPlan(plan);
    if (
      encoder.encode(
        JSON.stringify({
          version: 2,
          scope: this.scope,
          mutationId: this.scope.collection,
          plan: captured,
          phase: "confirmed",
        }),
      ).byteLength > maxBytes
    )
      fail("binding");
    return this.exclusive(signal, async (db) => {
      const stored = await this.read(db, signal),
        existing = await this.unwrap(stored, signal);
      if (existing) {
        const original = packIntent(existing);
        if (JSON.stringify(original.plan) !== JSON.stringify(captured))
          fail("binding");
        return original;
      }
      const intent = packIntent(
        decode(
          {
            version: 2,
            scope: this.scope,
            mutationId: crypto.randomUUID(),
            plan: captured,
            phase: "prepared",
          },
          this.scope,
        ),
      );
      return this.commit(db, stored, intent, signal);
    });
  }
  private advance(
    id: string,
    phase: ModelSetupIntent["phase"],
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    return this.exclusive(signal, async (db) => {
      const stored = await this.read(db, signal),
        loaded = await this.unwrap(stored, signal);
      if (!loaded) fail("recovery_required");
      const existing = packIntent(loaded);
      if (existing.mutationId !== id) fail("binding");
      const from = phases.indexOf(existing.phase),
        to = phases.indexOf(phase);
      if (to < from || to > from + 1) fail("recovery_required");
      if (to === from) return existing;
      return this.commit(
        db,
        stored,
        packIntent(decode({ ...existing, phase }, this.scope)),
        signal,
      );
    });
  }
  recordAttempt(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    return this.advance(id, "attempted", signal);
  }
  recordConfirmed(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    return this.advance(id, "confirmed", signal);
  }
  recordVerified(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    return this.advance(id, "verified", signal);
  }
}
