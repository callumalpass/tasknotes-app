import { flushSync } from "react-dom";

/**
 * How a route change moves: `switch` replaces the workspace in place,
 * `forward` opens task details over it, `replace` swaps one task's details for
 * another's, and `back` returns to the workspace.
 * The styles key off `html[data-navigation-motion]` (06-navigation.css).
 */
export type NavigationMotion = "switch" | "forward" | "replace" | "back";

let generation = 0;

/**
 * Applies a route update inside a view transition when the platform supports
 * one and motion is allowed; otherwise applies it immediately.
 */
export function transitionNavigation(
  motion: NavigationMotion,
  update: () => void,
  { traversal = false }: { traversal?: boolean } = {},
): void {
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  // Chrome times out a transition started within a history traversal's
  // popstate task, so a traversal starts its transition in the next task.
  if (traversal) {
    setTimeout(() => startTransition(motion, update));
    return;
  }
  startTransition(motion, update);
}

function startTransition(motion: NavigationMotion, update: () => void) {
  const root = document.documentElement;
  const current = ++generation;
  root.dataset.navigationMotion = motion;
  // Animation frames do not run while the update is pending, so the commit,
  // and the focus and scroll restoration in its layout effects, is synchronous.
  const transition = document.startViewTransition(() => flushSync(update));
  // A newer navigation may skip this one; that is expected, not an error.
  transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (generation === current) delete root.dataset.navigationMotion;
    });
}

export function navigationMotion(
  from: { page: string },
  to: { page: string },
): NavigationMotion {
  if (to.page === "task") return from.page === "task" ? "replace" : "forward";
  return from.page === "task" ? "back" : "switch";
}
