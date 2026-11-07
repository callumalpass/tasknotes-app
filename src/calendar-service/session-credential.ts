const DATABASE = "tasknotes.calendar-session.v1";
const STORE = "credential";
const RECORD = "current";

interface SealedCredential {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export interface CredentialStore {
  load(): Promise<string | null>;
  save(credential: string): Promise<void>;
  clear(): Promise<void>;
}

function completed<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as Error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const database = await completed(open);
  try {
    const transaction = database.transaction(STORE, mode);
    const result = completed(action(transaction.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error as Error);
    });
    return await result;
  } finally {
    database.close();
  }
}

/**
 * Native sessions are bearer-only (service ADR 0006), so the app must hold the
 * credential. It stays sealed under a key no script can export, as the mdbase
 * SDK keeps its own in this WebView; it never reaches localStorage or React.
 */
export const sealedCredentialStore: CredentialStore = {
  async load() {
    const sealed = await withStore<SealedCredential | undefined>(
      "readonly",
      (store) => store.get(RECORD) as IDBRequest<SealedCredential | undefined>,
    );
    if (!sealed) return null;
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: sealed.iv },
        sealed.key,
        sealed.ciphertext,
      ),
    );
  },
  async save(credential) {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(credential),
    );
    const sealed: SealedCredential = { key, iv, ciphertext };
    await withStore("readwrite", (store) => store.put(sealed, RECORD));
  },
  async clear() {
    await withStore("readwrite", (store) => store.delete(RECORD));
  },
};
