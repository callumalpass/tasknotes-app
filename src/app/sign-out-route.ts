import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

type Observed = Pick<MdbaseSnapshot, "phase">;
type PhaseKind = NonNullable<Observed["phase"]>["kind"];

/** Phases in which someone is signed in, so a later signed_out is a sign-out. */
const signedIn = new Set<PhaseKind>([
  "choosing",
  "opening",
  "needs_approval",
  "needs_setup",
  "ready",
  "problem",
  "unavailable",
]);

/**
 * Signing out leaves the workspace, so the address goes back to the app's
 * home: a stale /more would otherwise reopen settings after the next sign-in.
 * Opening a deep link while signed out keeps it for after sign-in.
 */
export function followSignOutRoute(
  source: {
    getSnapshot(): Observed;
    subscribe(listener: () => void): () => void;
  },
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
  base: string = import.meta.env.BASE_URL,
): () => void {
  let previous = source.getSnapshot().phase?.kind;
  return source.subscribe(() => {
    const kind = source.getSnapshot().phase?.kind;
    const signedOut =
      kind === "signed_out" && previous !== undefined && signedIn.has(previous);
    previous = kind;
    if (!signedOut) return;
    const home = `${base.replace(/\/$/, "")}/`;
    if (location.pathname !== home || location.search)
      history.replaceState(null, "", `${home}${location.hash}`);
  });
}
