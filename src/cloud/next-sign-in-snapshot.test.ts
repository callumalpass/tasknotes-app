import { isNextSignInSnapshot } from "./next-sign-in-snapshot";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
const cp = "https://connect-lab.mdbase.dev";
const id = "11111111-1111-4111-8111-111111111111";
function snapshot(): AppWebSignInSnapshot {
  return {
    status: "unselected",
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
    signIn: {
      requestId: id,
      installationId: id,
      deviceId: id,
      appId: id,
      kind: "app-runtime",
      verificationUri: `${cp}/pair/${id}`,
      state: "paired",
      accountId: id,
      accountEmail: null,
      accountProvider: "github",
      accountLogin: "test-login",
      collectionIds: [],
      createCollections: false,
      requestedCreateCollections: true,
    },
  };
}
it("accepts only canonical bounded provider display metadata while retaining account UUID authority", () => {
  const value = snapshot();
  expect(isNextSignInSnapshot(value, cp)).toBe(true);
  expect(value.signIn?.accountId).toBe(id);
  expect(value.signIn?.accountEmail).toBeNull();
  const uuidLogin = {
    ...value,
    signIn: {
      ...value.signIn,
      accountLogin: "22222222-2222-4222-8222-222222222222",
    },
  };
  expect(isNextSignInSnapshot(uuidLogin, cp)).toBe(true);
  expect(uuidLogin.signIn.accountId).toBe(id);
});
it.each([
  { accountProvider: "unknown" },
  { accountProvider: undefined },
  { accountProvider: null },
  { accountLogin: undefined },
  { accountLogin: null },
  { accountLogin: "" },
  { accountLogin: "test login" },
  { accountLogin: "test\nlogin" },
  { accountLogin: "test\u0000login" },
  { accountLogin: "test\u007flogin" },
  { accountLogin: "a".repeat(101) },
  { accountLogin: "é".repeat(51) },
  { accountEmail: "person@example.test" },
  { accountEmail: undefined },
  { accountId: null },
  { accountId: "test-login" },
  { secret: "stand-in" },
])(
  "refuses partial, mixed, oversized or unknown-provider display metadata %j",
  (fields) => {
    const value = snapshot();
    expect(
      isNextSignInSnapshot(
        { ...value, signIn: { ...value.signIn, ...fields } },
        cp,
      ),
    ).toBe(false);
  },
);
it.each(["a".repeat(100), "é".repeat(50)])(
  "matches the SDK's UTF-8 byte bound, not a character approximation",
  (accountLogin) => {
    const value = snapshot();
    expect(
      isNextSignInSnapshot(
        { ...value, signIn: { ...value.signIn, accountLogin } },
        cp,
      ),
    ).toBe(true);
  },
);
it("preserves existing email-only and no-display snapshots", () => {
  const value = snapshot();
  const { accountProvider, accountLogin, ...signIn } = value.signIn!;
  expect(accountProvider).toBe("github");
  expect(accountLogin).toBe("test-login");
  expect(
    isNextSignInSnapshot(
      { ...value, signIn: { ...signIn, accountEmail: "person@example.test" } },
      cp,
    ),
  ).toBe(true);
  expect(isNextSignInSnapshot({ ...value, signIn }, cp)).toBe(true);
  expect(isNextSignInSnapshot({ ...value, signIn: null }, cp)).toBe(true);
});
it("still refuses a foreign portal origin or fields outside the public presentation schema", () => {
  const value = snapshot();
  expect(isNextSignInSnapshot({ ...value, host: {} }, cp)).toBe(false);
  expect(
    isNextSignInSnapshot(
      {
        ...value,
        signIn: {
          ...value.signIn,
          verificationUri: `https://other.example.test/pair/${id}`,
        },
      },
      cp,
    ),
  ).toBe(false);
});
