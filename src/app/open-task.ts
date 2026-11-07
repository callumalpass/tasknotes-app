import { useSyncExternalStore } from "react";

let openId: string | null = null;
const listeners = new Set<() => void>();

/** Records which task the detail panel shows, so its list row can say so. */
export function setOpenTask(id: string | null) {
  if (openId === id) return;
  openId = id;
  for (const listener of listeners) listener();
}

export function useTaskOpen(id: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openId === id,
  );
}
