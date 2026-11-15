import { describe, it, expect } from "vitest";
import { challenge, consumeTransaction } from "./oauth";
function fixture() {
  const tx = {
    state: "unguessable-state",
    verifier: "verifier",
    created: 1000,
    clientId: "https://example.com/oauth/client.json",
    redirectUri: "https://example.com/auth/todoist/callback",
  };
  let saved: string | null = JSON.stringify(tx);
  const storage = {
    getItem: () => saved,
    removeItem: () => {
      saved = null;
    },
  };
  const url = new URL(`${tx.redirectUri}?state=${tx.state}&code=one-time-code`);
  return { tx, storage, url };
}
describe("OAuth boundary", () => {
  it("implements the RFC 7636 S256 test vector", async () => {
    expect(await challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("consumes a matching callback exactly once", () => {
    const { url, storage } = fixture();
    expect(consumeTransaction(url, storage, 2000).code).toBe("one-time-code");
    expect(() => consumeTransaction(url, storage, 2000)).toThrow("no matching");
  });
  it("rejects mismatched state and destroys the transaction", () => {
    const { url, storage } = fixture();
    url.searchParams.set("state", "attacker");
    expect(() => consumeTransaction(url, storage, 2000)).toThrow(
      "verification",
    );
    expect(storage.getItem()).toBeNull();
  });
  it("rejects expired transactions and callback origin substitution", () => {
    const a = fixture();
    expect(() => consumeTransaction(a.url, a.storage, 700000)).toThrow(
      "expired",
    );
    const b = fixture();
    b.url.host = "attacker.com";
    expect(() => consumeTransaction(b.url, b.storage, 2000)).toThrow(
      "verification",
    );
  });
  it("handles user denial without exchanging a code", () => {
    const { url, storage } = fixture();
    url.searchParams.set("error", "access_denied");
    expect(() => consumeTransaction(url, storage, 2000)).toThrow("declined");
  });
});
