const PROJECT_JUMP_EVENT = "tasknotes:project-jump";

let pending: string | null = null;

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
