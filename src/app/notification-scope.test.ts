import { expect, it, vi } from "vitest";
import type {
  Mdbase,
  MdbaseApplicationConnection,
  MdbaseSnapshot,
} from "@mdbase-dev/sdk";
import {
  notificationScope,
  withNotificationTeardown,
} from "./notification-scope";

const timers = {} as NonNullable<MdbaseApplicationConnection["timers"]>;
function fixture(grantId = "grant-original") {
  const connection = {
    scope: {
      account: "account",
      installation: "installation",
      collection: "collection",
    },
    timers,
  } as MdbaseApplicationConnection;
  const snapshot = {
    signIn: {
      accountId: "account",
      installationId: "installation",
      timerConsent: {
        approved: true,
        grants: [{ collectionId: "collection", grantId }],
      },
    },
  } as unknown as MdbaseSnapshot;
  return { connection, snapshot };
}

it("binds opt-in to account, collection, installation and original approved grant", () => {
  const f = fixture();
  const scope = notificationScope(f.connection, f.snapshot);
  expect(JSON.parse(scope.key)).toEqual([
    "account",
    "installation",
    "collection",
    "grant-original",
  ]);
  expect(scope.timers).toBe(timers);
  const renewed = fixture("grant-new");
  expect(notificationScope(renewed.connection, renewed.snapshot).key).not.toBe(
    scope.key,
  );
  expect(
    notificationScope({ ...f.connection, generation: "reopened" }, f.snapshot)
      .key,
  ).toBe(scope.key);
});

it.each(["account", "installation", "collection", "unapproved", "missing"])(
  "does not adopt notification consent from a %s mismatch",
  (mismatch) => {
    const f = fixture();
    if (mismatch === "missing") f.snapshot = { ...f.snapshot, signIn: null };
    else if (mismatch === "unapproved") {
      f.snapshot = {
        ...f.snapshot,
        signIn: {
          ...f.snapshot.signIn!,
          timerConsent: {
            ...f.snapshot.signIn!.timerConsent!,
            approved: false,
          },
        },
      };
    } else {
      f.connection = {
        ...f.connection,
        scope: { ...f.connection.scope, [mismatch]: "other" },
      };
    }
    expect(notificationScope(f.connection, f.snapshot).timers).toBeUndefined();
  },
);

it("awaits confirmed notification cleanup before sign-out tears down the original port", async () => {
  let finish!: () => void;
  const disabled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const signOut = vi.fn(async () => ({}) as MdbaseSnapshot);
  const disableIfEnabled = vi.fn(() => disabled);
  const facade = withNotificationTeardown({ signOut } as unknown as Mdbase, {
    disableIfEnabled,
  });
  const pending = facade.signOut({ discard: true });
  expect(disableIfEnabled).toHaveBeenCalledOnce();
  expect(signOut).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(signOut).toHaveBeenCalledExactlyOnceWith({ discard: true });
});

it("does not sign out after failed or ambiguous unregister", async () => {
  const signOut = vi.fn();
  const facade = withNotificationTeardown({ signOut } as unknown as Mdbase, {
    disableIfEnabled: async () => {
      throw new Error("Opt-out outcome is unknown");
    },
  });
  await expect(facade.signOut()).rejects.toThrow("unknown");
  expect(signOut).not.toHaveBeenCalled();
});

it("only stops this binding when explicitly deleting the selected collection", async () => {
  const disableIfEnabled = vi.fn(async () => undefined);
  const deleteCollection = vi.fn(async () => ({}) as MdbaseSnapshot);
  const facade = withNotificationTeardown(
    {
      getSnapshot: () => ({
        selection: { usable: { collectionId: "current" } },
      }),
      deleteCollection,
    } as unknown as Mdbase,
    { disableIfEnabled },
  );
  await facade.deleteCollection("other", { confirmName: "Other" });
  expect(disableIfEnabled).not.toHaveBeenCalled();
  await facade.deleteCollection("current", { confirmName: "Current" });
  expect(disableIfEnabled).toHaveBeenCalledOnce();
  expect(deleteCollection).toHaveBeenCalledTimes(2);
});
