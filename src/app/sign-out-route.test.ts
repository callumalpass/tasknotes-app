import { expect, it, vi } from "vitest";
import type { MdbaseSnapshot } from "@mdbase-dev/sdk";
import { followSignOutRoute } from "./sign-out-route";

function source(kind: string) {
  const listeners = new Set<() => void>();
  let snapshot = { phase: { kind } } as unknown as Pick<
    MdbaseSnapshot,
    "phase"
  >;
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    move(next: string) {
      snapshot = { phase: { kind: next } } as unknown as typeof snapshot;
      for (const listener of listeners) listener();
    },
  };
}

it("returns to home after signing out, but keeps a deep link opened signed out", () => {
  const history = { replaceState: vi.fn() };
  const location = { pathname: "/more", search: "?collection=c", hash: "" };
  const entry = source("ready");
  followSignOutRoute(entry, location, history, "/");
  entry.move("signed_out");
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/");

  const fresh = { replaceState: vi.fn() };
  const signedOut = source("starting");
  followSignOutRoute(signedOut, location, fresh, "/");
  signedOut.move("signed_out");
  signedOut.move("authorizing");
  signedOut.move("signed_out");
  expect(fresh.replaceState).not.toHaveBeenCalled();
});
