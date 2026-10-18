import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 839px)";

function subscribe(listener: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}

/** Matches the phone layout breakpoint used by the navigation styles. */
export function useNarrowLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(QUERY).matches),
    () => false,
  );
}
