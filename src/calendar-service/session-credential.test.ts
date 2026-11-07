import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { sealedCredentialStore as store } from "./session-credential";

const CREDENTIAL = "v1.a-session-credential";

function readSealed(): Promise<{ key: CryptoKey; ciphertext: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("tasknotes.calendar-session.v1", 1);
    open.onerror = () => reject(open.error as Error);
    open.onsuccess = () => {
      const database = open.result;
      const get = database
        .transaction("credential")
        .objectStore("credential")
        .get("current");
      get.onsuccess = () => {
        database.close();
        resolve(get.result);
      };
    };
  });
}

describe("sealedCredentialStore", () => {
  beforeEach(() => store.clear());

  it("is empty until saved, and empty again once cleared", async () => {
    expect(await store.load()).toBeNull();
    await store.save(CREDENTIAL);
    expect(await store.load()).toBe(CREDENTIAL);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("stores only ciphertext under a key that cannot be exported", async () => {
    await store.save(CREDENTIAL);
    const { key, ciphertext } = await readSealed();

    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    expect(new TextDecoder().decode(ciphertext)).not.toContain(CREDENTIAL);
  });

  it("replaces the previous credential", async () => {
    await store.save(CREDENTIAL);
    await store.save("v1.a-later-credential");
    expect(await store.load()).toBe("v1.a-later-credential");
  });
});
