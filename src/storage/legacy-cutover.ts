// Read-only cutover inventory. Do NOT import classic Connect/Dexie helpers:
// beta.125 PendingMutationStore.list() migrates and deletes its base key.
// This is a review/export snapshot, never a replay request or native authority.
export const LEGACY_CUTOVER_SOURCE = Object.freeze({
  tasknotesCommit: "d1869ab9577f0f3dd124efb7a56c714e32fdd385",
  connectVersion: "0.1.0-beta.125",
} as const);

export const LEGACY_CUTOVER_LIMITS = Object.freeze({
  items: 128,
  storageKeys: 1024,
  databases: 128,
  valueBytes: 256 * 1024,
  passBytes: 512 * 1024,
  observedBytes: 1024 * 1024,
  exportBytes: 1024 * 1024,
  depth: 16,
  nodes: 32768,
  timeoutMs: 5000,
} as const);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Issue =
  | "storage_unreadable"
  | "indexeddb_unreadable"
  | "drafts_unreadable"
  | "draft_handoff_unqualified"
  | "source_unknown"
  | "record_unknown"
  | "source_changed"
  | "budget_exceeded"
  | "timeout";
type Kind =
  "pending-mutation" | "deletion-command" | "attachment-intent" | "dirty-draft";

export interface LegacyHeldItem {
  readonly kind: Kind;
  readonly provenance: {
    readonly container: string;
    readonly locatorSha256: string;
    readonly originalSha256: string;
  };
  /** Credential-redacted review data, not an exact/replayable protocol request. */
  readonly data: Json;
  readonly redacted: boolean;
  readonly encryptedContentUnavailable: boolean;
}

export interface LegacyCutoverSnapshot {
  readonly format: "tasknotes-legacy-review/1";
  readonly source: typeof LEGACY_CUTOVER_SOURCE;
  readonly status: "clear" | "held" | "unknown";
  readonly complete: boolean;
  /** Durable storage ONLY; never use this to clear the native startup gate. */
  readonly durableStatus: "clear" | "held" | "unknown";
  readonly draftHandoffQualified: false;
  readonly issues: readonly Issue[];
  readonly items: readonly LegacyHeldItem[];
  readonly observedBytes: number;
}

export interface LegacyDirtyDraftReview {
  readonly format: "tasknotes-legacy-draft-review/1";
  readonly sourceCommit: typeof LEGACY_CUTOVER_SOURCE.tasknotesCommit;
  readonly captureId: string;
  readonly items: readonly unknown[];
}

export interface LegacyCutoverSources {
  readonly storage?: Pick<Storage, "length" | "key" | "getItem">;
  readonly indexedDB?: IDBFactory;
  /** Owner-captured legacy editor state. Missing/unreadable is NOT an empty list.
   * Frozen d1869 has no durable dirty-editor-draft store; do not invent one or
   * instantiate an old repository to obtain this input. */
  readonly dirtyDrafts?: LegacyDirtyDraftReview;
}

const JOURNALS = {
  "tasknotes-commands-v2": { store: "commands", key: "operationId" },
  "tasknotes-attachment-journal-v1": { store: "entries", key: "id" },
} as const;
const encoder = new TextEncoder();
class Refusal extends Error {
  constructor(readonly issue: Issue) {
    super(issue);
  }
}
interface Context {
  bytes: number;
  passBytes: number;
  passItems: number;
  nodes: number;
  deadline: number;
  cancelled: boolean;
}
interface Observed {
  container: string;
  locator: string;
  raw: string;
  value: Json;
  kind: Kind;
}
interface Capture {
  records: Observed[];
  inventory: string[];
}

function refuse(issue: Issue): never {
  throw new Refusal(issue);
}
function check(context: Context): void {
  if (context.cancelled || performance.now() >= context.deadline)
    refuse("timeout");
}
function admitItem(context: Context): void {
  check(context);
  if (++context.passItems > LEGACY_CUTOVER_LIMITS.items)
    refuse("budget_exceeded");
}
function admit(raw: string, context: Context): void {
  check(context);
  if (raw.length > LEGACY_CUTOVER_LIMITS.valueBytes) refuse("budget_exceeded");
  const bytes = encoder.encode(raw).byteLength;
  context.bytes += bytes;
  context.passBytes += bytes;
  if (
    bytes > LEGACY_CUTOVER_LIMITS.valueBytes ||
    context.bytes > LEGACY_CUTOVER_LIMITS.observedBytes ||
    context.passBytes > LEGACY_CUTOVER_LIMITS.passBytes
  )
    refuse("budget_exceeded");
}

// Bound recursion before JSON.parse; brackets inside strings are not structure.
function parse(raw: string, context: Context): Json {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const character of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") {
      if (++depth > LEGACY_CUTOVER_LIMITS.depth) refuse("budget_exceeded");
    } else if (character === "]" || character === "}") depth--;
  }
  try {
    return copyJson(JSON.parse(raw), context);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    return refuse("record_unknown");
  }
}

// Never invoke toJSON/accessors on owner snapshots or IndexedDB records.
function copyJson(
  value: unknown,
  context: Context,
  depth = 0,
  copyBudget = { bytes: 0, max: LEGACY_CUTOVER_LIMITS.valueBytes as number },
): Json {
  function cost(bytes: number): void {
    if ((copyBudget.bytes += bytes) > copyBudget.max) refuse("budget_exceeded");
  }
  if (
    ++context.nodes > LEGACY_CUTOVER_LIMITS.nodes ||
    depth > LEGACY_CUTOVER_LIMITS.depth
  )
    refuse("budget_exceeded");
  if (value === null || typeof value === "boolean") {
    cost(value === null || value === true ? 4 : 5);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse("record_unknown");
    cost(String(value).length);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > LEGACY_CUTOVER_LIMITS.valueBytes)
      refuse("budget_exceeded");
    cost(encoder.encode(JSON.stringify(value)).byteLength);
    return value;
  }
  if (typeof value !== "object" || Object.getOwnPropertySymbols(value).length)
    refuse("record_unknown");
  if (Array.isArray(value) && value.length > LEGACY_CUTOVER_LIMITS.nodes)
    refuse("budget_exceeded");
  cost(2);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (value.length > LEGACY_CUTOVER_LIMITS.nodes) refuse("budget_exceeded");
    const result: Json[] = [];
    for (let index = 0; index < value.length; index++) {
      const entry = descriptors[String(index)];
      if (!entry || !("value" in entry)) refuse("record_unknown");
      if (index) cost(1);
      result.push(copyJson(entry.value, context, depth + 1, copyBudget));
    }
    if (Object.keys(descriptors).length !== value.length + 1)
      refuse("record_unknown");
    return result;
  }
  // IndexedDB/JSON objects only, not Dates, Blobs, typed arrays or class instances.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null)
    refuse("record_unknown");
  const result: { [key: string]: Json } = Object.create(null);
  let fields = 0;
  for (const [key, entry] of Object.entries(descriptors)) {
    if (!("value" in entry) || !entry.enumerable) refuse("record_unknown");
    if (key.length > 1024) refuse("budget_exceeded");
    cost(
      encoder.encode(JSON.stringify(key)).byteLength + 1 + (fields++ ? 1 : 0),
    );
    result[key] = copyJson(entry.value, context, depth + 1, copyBudget);
  }
  return result;
}

function object(value: Json): { [key: string]: Json } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    refuse("record_unknown");
  return value;
}
function identifier(value: Json | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,255}$/.test(value)
  );
}
function timestamp(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function pendingKey(key: string): boolean {
  return (
    key.startsWith("mdbase-connect:") && key.includes(":pending-mutation:")
  );
}
function unknownLocalKey(key: string): boolean {
  return (
    /^tasknotes[:-]/.test(key) &&
    !key.startsWith("tasknotes-next-") &&
    /draft|pending|command|journal/i.test(key)
  );
}

function captureLocal(
  sources: LegacyCutoverSources,
  context: Context,
): Capture {
  const storage = sources.storage;
  if (!storage) refuse("storage_unreadable");
  const length = storage.length;
  if (!Number.isSafeInteger(length) || length < 0) refuse("storage_unreadable");
  if (length > LEGACY_CUTOVER_LIMITS.storageKeys) refuse("budget_exceeded");
  const inventory: string[] = [];
  for (let index = 0; index < length; index++) {
    const key = storage.key(index);
    if (typeof key !== "string") refuse("source_changed");
    if (key.length > 2048) refuse("budget_exceeded");
    if (unknownLocalKey(key)) refuse("source_unknown");
    if (pendingKey(key)) inventory.push(key);
  }
  inventory.sort();
  if (new Set(inventory).size !== inventory.length || storage.length !== length)
    refuse("source_changed");
  const records: Observed[] = [];
  for (const key of inventory) {
    if (records.length >= LEGACY_CUTOVER_LIMITS.items)
      refuse("budget_exceeded");
    admitItem(context);
    const raw = storage.getItem(key); // Never read token, PKCE, key-store or authorization keys.
    if (raw === null) refuse("source_changed");
    admit(raw, context);
    const value = parse(raw, context);
    const row = object(value);
    if (
      !identifier(row.collectionId) ||
      !identifier(row.requestId) ||
      !identifier(row.operation) ||
      !timestamp(row.createdAt) ||
      row.createdAt === 0 ||
      typeof row.inputFingerprint !== "string" ||
      (!row.envelope && !row.request)
    )
      refuse("record_unknown");
    const suffix = `:pending-mutation:${row.collectionId}`;
    if (
      !key.endsWith(suffix) &&
      !key.endsWith(`${suffix}:${encodeURIComponent(row.requestId)}`)
    )
      refuse("record_unknown");
    if (row.request) {
      const request = object(row.request);
      if (
        request.request_id !== row.requestId ||
        !Object.hasOwn(request, "input")
      )
        refuse("record_unknown");
    }
    records.push({
      container: "connect-beta125-pending",
      locator: key,
      raw,
      value,
      kind: "pending-mutation",
    });
  }
  return { records, inventory };
}

async function wait<T>(promise: Promise<T>, context: Context): Promise<T> {
  check(context);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          context.cancelled = true;
          reject(new Refusal("timeout"));
        }, context.deadline - performance.now());
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readJournal(
  factory: IDBFactory,
  name: keyof typeof JOURNALS,
  version: number,
  context: Context,
): Promise<Observed[]> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let finished = false;
    const timer = setTimeout(
      () => fail(new Refusal("timeout")),
      Math.max(0, context.deadline - performance.now()),
    );
    function fail(error: unknown): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        transaction?.abort();
      } catch {
        /* Already completed; read-only. */
      }
      db?.close();
      reject(error);
    }
    // Only names enumerated as EXISTING are opened, at their exact current version.
    // IDB has no atomic "open-existing" API: if deletion races enumeration, abort
    // onupgradeneeded BEFORE any schema operation; no creation/upgrade commits.
    const opening = factory.open(name, version);
    opening.onupgradeneeded = () => {
      opening.transaction?.abort();
      fail(new Refusal("source_changed"));
    };
    opening.onblocked = () => fail(new Refusal("indexeddb_unreadable"));
    opening.onerror = () => fail(new Refusal("indexeddb_unreadable"));
    opening.onsuccess = () => {
      db = opening.result;
      if (finished || context.cancelled) {
        db.close();
        return;
      }
      db.onversionchange = () => fail(new Refusal("source_changed"));
      try {
        const schema = JOURNALS[name];
        if (
          db.version !== 10 ||
          db.objectStoreNames.length !== 1 ||
          !db.objectStoreNames.contains(schema.store)
        )
          refuse("source_unknown"); // Frozen Dexie version(1) is physical IDB version10.
        transaction = db.transaction(schema.store, "readonly");
        const store = transaction.objectStore(schema.store);
        if (store.keyPath !== schema.key || store.autoIncrement)
          refuse("source_unknown");
        const records: Observed[] = [];
        const cursor = store.openCursor();
        cursor.onerror = () => fail(new Refusal("indexeddb_unreadable"));
        cursor.onsuccess = () => {
          if (finished) return;
          try {
            check(context);
            const item = cursor.result;
            if (!item) return;
            if (records.length >= LEGACY_CUTOVER_LIMITS.items)
              refuse("budget_exceeded");
            admitItem(context);
            const value = copyJson(item.value, context);
            const raw = JSON.stringify(value);
            admit(raw, context);
            const row = object(value);
            if (!identifier(row.collectionId) || !identifier(row.taskId))
              refuse("record_unknown");
            if (name === "tasknotes-commands-v2") {
              if (
                row.kind !== "delete-task" ||
                !identifier(row.operationId) ||
                typeof row.title !== "string" ||
                !timestamp(row.requestedAt) ||
                !timestamp(row.commitAfter) ||
                (row.authorityRequestId !== undefined &&
                  !identifier(row.authorityRequestId)) ||
                item.primaryKey !== row.operationId
              )
                refuse("record_unknown");
            } else if (
              !identifier(row.id) ||
              typeof row.reference !== "string" ||
              !timestamp(row.enqueuedAt) ||
              (row.expectedDigest !== undefined &&
                (typeof row.expectedDigest !== "string" ||
                  !/^sha256:[0-9a-f]{64}$/.test(row.expectedDigest))) ||
              (row.expectedSize !== undefined &&
                !timestamp(row.expectedSize)) ||
              (row.fileSaved !== undefined &&
                typeof row.fileSaved !== "boolean") ||
              item.primaryKey !== row.id
            )
              refuse("record_unknown");
            records.push({
              container: name,
              locator: String(item.primaryKey),
              raw,
              value,
              kind:
                name === "tasknotes-commands-v2"
                  ? "deletion-command"
                  : "attachment-intent",
            });
            item.continue();
          } catch (error) {
            fail(error);
          }
        };
        transaction.onerror = () => fail(new Refusal("indexeddb_unreadable"));
        transaction.onabort = () => fail(new Refusal("indexeddb_unreadable"));
        transaction.oncomplete = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          db?.close();
          resolve(records);
        };
      } catch (error) {
        fail(error);
      }
    };
  });
}

async function capture(
  sources: LegacyCutoverSources,
  context: Context,
): Promise<Capture> {
  context.passBytes = 0;
  context.passItems = 0;
  const local = captureLocal(sources, context);
  const records = local.records;
  // This shape records review provenance, NOT authentication of a legacy RAM
  // capture. The real legacy-owner producer/handoff remains an explicit blocker.
  let draftCapture: { [key: string]: Json } | undefined;
  if (sources.dirtyDrafts !== undefined) {
    const review = copyJson(sources.dirtyDrafts, context, 0, {
      bytes: 0,
      max: LEGACY_CUTOVER_LIMITS.passBytes,
    });
    if (!review || typeof review !== "object" || Array.isArray(review))
      refuse("drafts_unreadable");
    draftCapture = review;
    if (
      draftCapture.format !== "tasknotes-legacy-draft-review/1" ||
      draftCapture.sourceCommit !== LEGACY_CUTOVER_SOURCE.tasknotesCommit ||
      !identifier(draftCapture.captureId) ||
      !Array.isArray(draftCapture.items) ||
      Object.keys(draftCapture).length !== 4
    )
      refuse("drafts_unreadable");
    for (const [index, value] of draftCapture.items.entries()) {
      admitItem(context);
      const raw = JSON.stringify(value);
      admit(raw, context);
      records.push({
        container: "unqualified-owner-dirty-drafts",
        locator: `${draftCapture.captureId}:${index}`,
        raw,
        value,
        kind: "dirty-draft",
      });
    }
  }
  const factory = sources.indexedDB;
  if (!factory || typeof factory.databases !== "function")
    refuse("indexeddb_unreadable");
  const databases = await wait(factory.databases(), context);
  if (databases.length > LEGACY_CUTOVER_LIMITS.databases)
    refuse("budget_exceeded");
  const inventory = [
    ...local.inventory.map((key) => `local:${key}`),
    `draft:${draftCapture?.captureId ?? "missing"}`,
  ];
  const names = new Set<string>();
  databases.sort((left, right) =>
    String(left.name).localeCompare(String(right.name)),
  );
  for (const database of databases) {
    if (
      typeof database.name !== "string" ||
      !Number.isSafeInteger(database.version) ||
      !database.version
    )
      refuse("indexeddb_unreadable");
    if (names.has(database.name)) refuse("source_changed");
    names.add(database.name);
    if (Object.hasOwn(JOURNALS, database.name)) {
      inventory.push(`idb:${database.name}:${database.version}`);
      records.push(
        ...(await readJournal(
          factory,
          database.name as keyof typeof JOURNALS,
          database.version,
          context,
        )),
      );
    } else if (
      database.name.startsWith("tasknotes-") &&
      !database.name.startsWith("tasknotes-next-")
    )
      refuse("source_unknown");
  }
  if (records.length > LEGACY_CUTOVER_LIMITS.items) refuse("budget_exceeded");
  inventory.sort();
  return { records, inventory };
}

const CREDENTIAL_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "bearer",
  "authorization",
  "password",
  "secret",
  "privatekey",
  "signsecretkey",
  "kemsecretkey",
  "seed",
  "key",
  "keyhandle",
  "keyid",
  "grantid",
  "credentials",
  "cookie",
  "headers",
  "signature",
  "envelope",
  "encryption",
  "proof",
  "transport",
  "apikey",
]);
function redact(value: Json, state: { redacted: boolean }): Json {
  if (typeof value === "string") {
    if (
      /\b(?:Bearer|Basic)\s+\S+|(?:https?:\/\/[^\s/@]+:[^\s/@]+@)|(?:[a-z_-]*(?:token|signature|secret|password)[a-z_-]*)=/i.test(
        value,
      )
    ) {
      state.redacted = true;
      return "[redacted credential-bearing text]";
    }
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, state));
  const result: { [key: string]: Json } = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    if (
      CREDENTIAL_KEYS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase()) ||
      /token|secret|password|private.?key|credential|signature|authorization|bearer|key.?handle|transport.?key|proof/i.test(
        key,
      ) ||
      key === "__proto__" ||
      key === "constructor"
    ) {
      state.redacted = true;
      continue;
    }
    result[key] = redact(entry, state);
  }
  return result;
}
async function digest(value: string, context: Context): Promise<string> {
  const bytes = await wait(
    crypto.subtle.digest("SHA-256", encoder.encode(value)),
    context,
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reviewData(record: Observed): {
  data: Json;
  redacted: boolean;
  encryptedContentUnavailable: boolean;
} {
  const state = { redacted: false };
  if (record.kind === "pending-mutation") {
    const row = object(record.value);
    const summary: { [key: string]: Json } = {
      collectionId: row.collectionId,
      requestId: row.requestId,
      operation: row.operation,
      createdAt: row.createdAt,
    };
    if (identifier(row.mutation)) summary.mutation = row.mutation;
    if (row.request) summary.input = object(row.request).input;
    // Never export grant material, relay envelopes or a transport request wrapper.
    const encryptedContentUnavailable = !row.request;
    return {
      data: redact(summary, state),
      redacted: true,
      encryptedContentUnavailable,
    };
  }
  if (record.kind !== "dirty-draft") {
    const row = object(record.value);
    const fields =
      record.kind === "deletion-command"
        ? [
            "kind",
            "operationId",
            "collectionId",
            "taskId",
            "title",
            "requestedAt",
            "commitAfter",
            "authorityRequestId",
          ]
        : [
            "id",
            "collectionId",
            "taskId",
            "reference",
            "expectedDigest",
            "expectedSize",
            "fileSaved",
            "enqueuedAt",
          ];
    const data: { [key: string]: Json } = Object.create(null);
    for (const field of fields)
      if (Object.hasOwn(row, field)) data[field] = row[field];
    // An arbitrary old reference may contain a signed URL/transport credential.
    // Only the frozen app's plain relative attachment paths are exportable.
    if (
      record.kind === "attachment-intent" &&
      (typeof data.reference !== "string" ||
        !/^attachments\/[A-Za-z0-9_./-]{1,1024}$/.test(data.reference) ||
        data.reference.split("/").includes(".."))
    ) {
      delete data.reference;
      data.referenceOpaque = true;
      state.redacted = true;
    }
    return {
      data: redact(data, state),
      redacted:
        state.redacted || Object.keys(row).length !== Object.keys(data).length,
      encryptedContentUnavailable: false,
    };
  }
  return {
    data: redact(record.value, state),
    redacted: state.redacted,
    encryptedContentUnavailable: false,
  };
}

/** Two bounded observations; visible drift refuses clear/complete publication.
 * Browser getItem/cursor structured-clone allocation precedes JS admission; these
 * are logical parser/export limits, NOT retained/peak-heap qualification. No
 * historical lease or cross-store atomic/ABA guarantee is claimed. */
export async function scanLegacyCutover(
  sources: LegacyCutoverSources,
): Promise<LegacyCutoverSnapshot> {
  const context: Context = {
    bytes: 0,
    passBytes: 0,
    passItems: 0,
    nodes: 0,
    deadline: performance.now() + LEGACY_CUTOVER_LIMITS.timeoutMs,
    cancelled: false,
  };
  const items: LegacyHeldItem[] = [];
  const issues: Issue[] = [];
  try {
    const first = await capture(sources, context);
    for (const record of first.records) {
      items.push({
        kind: record.kind,
        provenance: {
          container: record.container,
          locatorSha256: await digest(record.locator, context),
          originalSha256: await digest(record.raw, context),
        },
        ...reviewData(record),
      });
    }
    const second = await capture(sources, context);
    if (
      JSON.stringify(first.inventory) !== JSON.stringify(second.inventory) ||
      first.records.length !== second.records.length ||
      first.records.some((record, index) => {
        const other = second.records[index];
        return (
          record.container !== other.container ||
          record.locator !== other.locator ||
          record.raw !== other.raw
        );
      })
    )
      refuse("source_changed");
  } catch (error) {
    issues.push(error instanceof Refusal ? error.issue : "source_unknown");
  }
  const durableStatus = issues.length
    ? "unknown"
    : items.some((item) => item.kind !== "dirty-draft")
      ? "held"
      : "clear";
  // No new-app array/flag/self-attestation can qualify the missing frozen legacy
  // RAM capture producer. Even empty durable storage cannot clear native startup.
  if (sources.dirtyDrafts === undefined) issues.push("drafts_unreadable");
  issues.push("draft_handoff_unqualified");
  const snapshot: LegacyCutoverSnapshot = {
    format: "tasknotes-legacy-review/1",
    source: LEGACY_CUTOVER_SOURCE,
    status: "unknown",
    complete: false,
    durableStatus,
    draftHandoffQualified: false,
    issues,
    items,
    observedBytes: context.bytes,
  };
  if (
    encoder.encode(JSON.stringify(snapshot)).byteLength >
    LEGACY_CUTOVER_LIMITS.exportBytes
  )
    return {
      ...snapshot,
      status: "unknown",
      complete: false,
      items: [],
      issues: ["budget_exceeded"],
    };
  return snapshot;
}
