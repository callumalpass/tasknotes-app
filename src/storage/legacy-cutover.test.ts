// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEGACY_CUTOVER_LIMITS,
  LEGACY_CUTOVER_SOURCE,
  scanLegacyCutover,
  type LegacyCutoverSources,
  type LegacyDirtyDraftReview,
} from "./legacy-cutover";

const BASE =
  "mdbase-connect:https://connect.mdbase.dev:bundle:dev.tasknotes.app:pending-mutation:collection-1";
const TOKEN =
  "mdbase-connect:https://connect.mdbase.dev:bundle:dev.tasknotes.app:token:collection-1";
const oldDeletion = {
  kind: "delete-task",
  operationId: "delete-1",
  collectionId: "connect:collection-1",
  taskId: "task-1",
  title: "Keep my deletion",
  requestedAt: 2,
  commitAfter: 10,
  authorityRequestId: "request-1",
};
const oldAttachment = {
  id: "attach-1",
  collectionId: "connect:collection-1",
  taskId: "task-1",
  reference: "attachments/photo.png",
  enqueuedAt: 3,
  expectedSize: 123,
  fileSaved: false,
};
function pending(input: unknown = { title: "Unsaved title" }) {
  return {
    collectionId: "collection-1",
    requestId: "request-1",
    operation: "update",
    inputFingerprint: "PRIVATE-ORIGINAL-FINGERPRINT",
    createdAt: 123,
    request: { protocol_version: 1, request_id: "request-1", input },
  };
}
function draftReview(items: readonly unknown[] = []): LegacyDirtyDraftReview {
  return {
    format: "tasknotes-legacy-draft-review/1",
    sourceCommit: LEGACY_CUTOVER_SOURCE.tasknotesCommit,
    captureId: "UNIT-ONLY-unqualified-capture",
    items,
  };
}
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() {
      return values.size;
    },
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
  };
}
async function seed(
  factory: IDBFactory,
  name: string,
  storeName: string,
  keyPath: string,
  rows: readonly unknown[],
  version = 10,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(name, version);
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore(storeName, { keyPath });
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => resolve(opening.result);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    for (const row of rows) transaction.objectStore(storeName).put(row);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
async function rows(factory: IDBFactory, name: string, storeName: string) {
  const opening = factory.open(name);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const result = await new Promise<unknown[]>((resolve, reject) => {
    const request = db
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
function sources(
  extra: Partial<LegacyCutoverSources> = {},
): LegacyCutoverSources {
  return {
    storage: storage(),
    indexedDB: new IDBFactory(),
    dirtyDrafts: draftReview(),
    ...extra,
  };
}

afterEach(() => vi.useRealTimers());

describe("frozen legacy cutover read-only inventory", () => {
  it("never turns empty storage/new-app self-attestation into native startup clearance", async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, "open");
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result).toMatchObject({
      status: "unknown",
      complete: false,
      durableStatus: "clear",
      draftHandoffQualified: false,
      issues: ["draft_handoff_unqualified"],
      items: [],
    });
    expect(open).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([]);
  });

  it("makes absent RAM capture an explicit blocker while still inventorying durable data", async () => {
    const result = await scanLegacyCutover(
      sources({
        dirtyDrafts: undefined,
        storage: storage({ [BASE]: JSON.stringify(pending()) }),
      }),
    );
    expect(result.issues).toContain("drafts_unreadable");
    expect(result.issues).toContain("draft_handoff_unqualified");
    expect(result.durableStatus).toBe("held");
    expect(result.items).toHaveLength(1);
  });

  it("refuses a bare new-app empty array as a draft handoff", async () => {
    const result = await scanLegacyCutover(
      sources({ dirtyDrafts: [] as unknown as LegacyDirtyDraftReview }),
    );
    expect(result.status).toBe("unknown");
    expect(result.issues).toContain("drafts_unreadable");
  });

  it("reads both base and per-request entries without migrating, deleting or deduplicating either", async () => {
    const raw = JSON.stringify(pending());
    const local = storage({
      [BASE]: raw,
      [`${BASE}:request-1`]: raw,
      [TOKEN]: "FAKE-TOKEN-NOT-READ",
    });
    const before = [...local.values];
    const result = await scanLegacyCutover(sources({ storage: local }));
    expect(result.items).toHaveLength(2);
    expect(result.durableStatus).toBe("held");
    expect(result.items[0].provenance.locatorSha256).not.toBe(
      result.items[1].provenance.locatorSha256,
    );
    expect(result.items[0].provenance.originalSha256).toBe(
      result.items[1].provenance.originalSha256,
    );
    expect([...local.values]).toEqual(before);
    expect(local.getItem.mock.calls.every(([key]) => key !== TOKEN)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("FAKE-TOKEN-NOT-READ");
    expect(JSON.stringify(result)).not.toContain(
      "PRIVATE-ORIGINAL-FINGERPRINT",
    );
  });

  it("retains encrypted-only intent but never exports relay/grant/key material", async () => {
    const encrypted = {
      ...pending(),
      request: undefined,
      grantId: "SECRET-GRANT",
      keyHandle: "SECRET-KEY-HANDLE",
      encryption: { public_key: "SECRET-TRANSPORT-KEY" },
      envelope: { ciphertext: "SECRET-ENVELOPE", signature: "SECRET-PROOF" },
    };
    const local = storage({ [BASE]: JSON.stringify(encrypted) });
    const before = [...local.values];
    const result = await scanLegacyCutover(sources({ storage: local }));
    expect(result.items[0]).toMatchObject({
      encryptedContentUnavailable: true,
      redacted: true,
      data: { requestId: "request-1", operation: "update" },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-");
    expect([...local.values]).toEqual(before);
  });

  it("exports user edits through credential redaction, without exporting a replay wrapper", async () => {
    const input = {
      title: "Keep this title",
      nested: {
        access_token: "SECRET-TOKEN",
        transportKey: "SECRET-KEY",
        password: "SECRET-PASSWORD",
        content: "Keep this note",
      },
      headers: { authorization: "SECRET-BEARER" },
      url: "https://user:SECRET-PASSWORD@example.com",
      redirect: "https://example.com/?connection_token=SECRET-TOKEN",
    };
    const result = await scanLegacyCutover(
      sources({ storage: storage({ [BASE]: JSON.stringify(pending(input)) }) }),
    );
    expect(result.items[0].data).toMatchObject({
      input: {
        title: "Keep this title",
        nested: { content: "Keep this note" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-");
    expect(JSON.stringify(result)).not.toContain("protocol_version");
  });

  it("reads raw old command and attachment journals without changing records or versions", async () => {
    const factory = new IDBFactory();
    await seed(factory, "tasknotes-commands-v2", "commands", "operationId", [
      oldDeletion,
    ]);
    await seed(factory, "tasknotes-attachment-journal-v1", "entries", "id", [
      oldAttachment,
    ]);
    await seed(
      factory,
      "tasknotes-next-commands-v1",
      "commands",
      "operationId",
      [{ ...oldDeletion, operationId: "native-1" }],
    );
    const before = await factory.databases();
    const open = vi.spyOn(factory, "open");
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.items.map((item) => item.kind).sort()).toEqual([
      "attachment-intent",
      "deletion-command",
    ]);
    expect(
      open.mock.calls.every(
        ([name, version]) =>
          name !== "tasknotes-next-commands-v1" && version === 10,
      ),
    ).toBe(true);
    expect(await factory.databases()).toEqual(before);
    expect(await rows(factory, "tasknotes-commands-v2", "commands")).toEqual([
      oldDeletion,
    ]);
    expect(
      await rows(factory, "tasknotes-attachment-journal-v1", "entries"),
    ).toEqual([oldAttachment]);
    expect(
      await rows(factory, "tasknotes-next-commands-v1", "commands"),
    ).toEqual([{ ...oldDeletion, operationId: "native-1" }]);
  });

  it("keeps unsafe attachment references opaque and never exports signed URL credentials", async () => {
    const factory = new IDBFactory();
    const entry = {
      ...oldAttachment,
      reference: "https://example.com/file?X-Amz-Credential=FAKE-SECRET",
    };
    await seed(factory, "tasknotes-attachment-journal-v1", "entries", "id", [
      entry,
    ]);
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.items[0].data).toMatchObject({
      referenceOpaque: true,
      taskId: "task-1",
    });
    expect(JSON.stringify(result)).not.toContain("FAKE-SECRET");
    expect(
      await rows(factory, "tasknotes-attachment-journal-v1", "entries"),
    ).toEqual([entry]);
  });

  it("refuses a cumulatively oversized structured record before making an export copy", async () => {
    const factory = new IDBFactory();
    const entry = {
      ...oldDeletion,
      title: "x".repeat(150000),
      extra: "y".repeat(150000),
    };
    await seed(factory, "tasknotes-commands-v2", "commands", "operationId", [
      entry,
    ]);
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.issues).toContain("budget_exceeded");
    expect(result.complete).toBe(false);
    expect(await rows(factory, "tasknotes-commands-v2", "commands")).toEqual([
      entry,
    ]);
  });

  it("exports a supplied owner draft only as unqualified review provenance", async () => {
    const result = await scanLegacyCutover(
      sources({
        dirtyDrafts: draftReview([
          { title: "Unsaved editor", token: "SECRET-TOKEN" },
        ]),
      }),
    );
    expect(result.items[0]).toMatchObject({
      kind: "dirty-draft",
      data: { title: "Unsaved editor" },
      redacted: true,
    });
    expect(result.status).toBe("unknown");
    expect(result.complete).toBe(false);
    expect(result.draftHandoffQualified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN");
  });

  it.each(["", "null", "{broken", JSON.stringify({ unexpected: "payload" })])(
    "never treats unreadable/unknown legacy value %j as empty",
    async (raw) => {
      const local = storage({ [BASE]: raw });
      const before = [...local.values];
      const result = await scanLegacyCutover(sources({ storage: local }));
      expect(result.status).toBe("unknown");
      expect(result.durableStatus).toBe("unknown");
      expect(result.issues).toContain("record_unknown");
      expect([...local.values]).toEqual(before);
    },
  );

  it("refuses a mismatched request/key instead of silently ignoring it", async () => {
    const wrong = pending();
    wrong.request.request_id = "different-request";
    const result = await scanLegacyCutover(
      sources({ storage: storage({ [BASE]: JSON.stringify(wrong) }) }),
    );
    expect(result.issues).toContain("record_unknown");
  });

  it("holds unknown draft storage/journal schemas instead of opening/upgrading them", async () => {
    const factory = new IDBFactory();
    await seed(factory, "tasknotes-drafts-v9", "drafts", "id", [
      { id: "draft-1" },
    ]);
    const open = vi.spyOn(factory, "open");
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.issues).toContain("source_unknown");
    expect(open).not.toHaveBeenCalled();
    const localResult = await scanLegacyCutover(
      sources({
        storage: storage({ "tasknotes:dirty-drafts:v9": "PRIVATE-DRAFT" }),
      }),
    );
    expect(localResult.issues).toContain("source_unknown");
    expect(JSON.stringify(localResult)).not.toContain("PRIVATE-DRAFT");
  });

  it("aborts an enumeration/deletion race before an absent database can be created", async () => {
    const factory = new IDBFactory();
    const metadata = vi
      .spyOn(factory, "databases")
      .mockResolvedValue([{ name: "tasknotes-commands-v2", version: 10 }]);
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.issues).toContain("source_changed");
    metadata.mockRestore();
    expect(await factory.databases()).toEqual([]);
  });

  it("preserves an unsupported old schema and returns unknown", async () => {
    const factory = new IDBFactory();
    await seed(
      factory,
      "tasknotes-commands-v2",
      "commands",
      "operationId",
      [oldDeletion],
      20,
    );
    const before = await factory.databases();
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.issues).toContain("source_unknown");
    expect(await factory.databases()).toEqual(before);
  });

  it("refuses local source drift after real inventory/hashing", async () => {
    const local = storage({ [BASE]: JSON.stringify(pending()) });
    const original = local.getItem;
    let reads = 0;
    local.getItem = vi.fn((key: string) => {
      const value = original(key);
      return key === BASE && ++reads === 2
        ? JSON.stringify(pending({ title: "Changed" }))
        : value;
    });
    const result = await scanLegacyCutover(sources({ storage: local }));
    expect(result.issues).toContain("source_changed");
    expect(result.complete).toBe(false);
  });

  it("refuses real IndexedDB source drift between observations", async () => {
    const factory = new IDBFactory();
    await seed(factory, "tasknotes-commands-v2", "commands", "operationId", [
      oldDeletion,
    ]);
    const original = factory.databases.bind(factory);
    let reads = 0;
    vi.spyOn(factory, "databases").mockImplementation(async () => {
      if (++reads === 2)
        await seed(
          factory,
          "tasknotes-commands-v2",
          "commands",
          "operationId",
          [{ ...oldDeletion, title: "Changed" }],
        );
      return original();
    });
    const result = await scanLegacyCutover(sources({ indexedDB: factory }));
    expect(result.issues).toContain("source_changed");
  });

  it("refuses value/depth bounds before parsing/export and preserves original text", async () => {
    for (const raw of [
      "x".repeat(LEGACY_CUTOVER_LIMITS.valueBytes + 1),
      "[".repeat(17) + "0" + "]".repeat(17),
    ]) {
      const local = storage({ [BASE]: raw });
      const result = await scanLegacyCutover(sources({ storage: local }));
      expect(result.issues).toContain("budget_exceeded");
      expect(local.values.get(BASE)).toBe(raw);
    }
  });

  it("enforces the combined item cap across local pending and both old journal sources", async () => {
    const factory = new IDBFactory();
    const commands = Array.from({ length: 128 }, (_, index) => ({
      ...oldDeletion,
      operationId: `delete-${index}`,
    }));
    await seed(
      factory,
      "tasknotes-commands-v2",
      "commands",
      "operationId",
      commands,
    );
    const result = await scanLegacyCutover(
      sources({
        indexedDB: factory,
        storage: storage({ [BASE]: JSON.stringify(pending()) }),
      }),
    );
    expect(result.issues).toContain("budget_exceeded");
    expect(result.items.length).toBeLessThanOrEqual(128);
    expect(await rows(factory, "tasknotes-commands-v2", "commands")).toEqual(
      [...commands].sort((left, right) =>
        left.operationId < right.operationId
          ? -1
          : left.operationId > right.operationId
            ? 1
            : 0,
      ),
    );
  });

  it("enforces UTF8 source bytes and cumulative initial/final ledger, not only character count", async () => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < 3; index++) {
      const item = {
        ...pending({ content: "é".repeat(90000) }),
        requestId: `request-${index}`,
      };
      item.request.request_id = item.requestId;
      entries[`${BASE}:${item.requestId}`] = JSON.stringify(item);
    }
    const result = await scanLegacyCutover(
      sources({ storage: storage(entries) }),
    );
    expect(result.issues).toContain("budget_exceeded");
    expect(result.complete).toBe(false);
  });

  it("bounds key enumeration and does not export source exception messages", async () => {
    const tooMany = storage(
      Object.fromEntries(
        Array.from({ length: 1025 }, (_, index) => [
          `preference-${index}`,
          "x",
        ]),
      ),
    );
    expect(
      (await scanLegacyCutover(sources({ storage: tooMany }))).issues,
    ).toContain("budget_exceeded");
    const broken = storage({ [BASE]: "x" });
    broken.getItem.mockImplementation(() => {
      throw new Error("SECRET-EXCEPTION");
    });
    const result = await scanLegacyCutover(sources({ storage: broken }));
    expect(result.status).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("SECRET-EXCEPTION");
  });

  it("never invokes dirty-snapshot getters/toJSON or exports their side effects", async () => {
    let called = false;
    const item = Object.defineProperty({}, "password", {
      enumerable: true,
      get() {
        called = true;
        return "SECRET";
      },
    });
    const result = await scanLegacyCutover(
      sources({ dirtyDrafts: draftReview([item]) }),
    );
    expect(called).toBe(false);
    expect(result.status).toBe("unknown");
    const hooked = {
      toJSON() {
        called = true;
        return "SECRET";
      },
    };
    await scanLegacyCutover(sources({ dirtyDrafts: draftReview([hooked]) }));
    expect(called).toBe(false);
  });

  it("fails closed for unavailable storage/indexedDB and absent metadata enumeration", async () => {
    for (const extra of [
      { storage: undefined },
      { indexedDB: undefined },
      { indexedDB: {} as IDBFactory },
    ]) {
      const result = await scanLegacyCutover(sources(extra));
      expect(result.status).toBe("unknown");
      expect(result.complete).toBe(false);
    }
  });

  it("bounds a blocked metadata read by the fixed request deadline", async () => {
    vi.useFakeTimers();
    const factory = new IDBFactory();
    vi.spyOn(factory, "databases").mockImplementation(
      () => new Promise(() => {}),
    );
    const result = scanLegacyCutover(sources({ indexedDB: factory }));
    await vi.advanceTimersByTimeAsync(5001);
    expect((await result).issues).toContain("timeout");
  });
});
