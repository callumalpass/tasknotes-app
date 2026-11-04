import { useSyncExternalStore } from "react";

const PROJECT_JUMP_EVENT = "tasknotes:project-jump";

let pending: string | null = null;
let focused: string | null = null;
const focusListeners = new Set<() => void>();

/** Asks the shell to show a project; the Projects view takes it on arrival. */
export function requestProjectJump(label: string) {
  pending = label;
  window.dispatchEvent(new CustomEvent(PROJECT_JUMP_EVENT));
}

export function takeProjectJump(): string | null {
  const label = pending;
  pending = null;
  return label;
}

export function onProjectJump(listener: () => void) {
  window.addEventListener(PROJECT_JUMP_EVENT, listener);
  return () => window.removeEventListener(PROJECT_JUMP_EVENT, listener);
}

/** The one project the Projects view is narrowed to, if any. */
export function setFocusedProject(label: string | null) {
  if (focused === label) return;
  focused = label;
  for (const listener of focusListeners) listener();
}

export function useFocusedProject() {
  return useSyncExternalStore(
    (listener) => {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    () => focused,
  );
}
