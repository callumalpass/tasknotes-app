import { flushSync } from "react-dom";

/**
 * How a route change moves: `switch` replaces the workspace in place,
 * `forward` opens task details over it, `replace` swaps one task's details for
 * another's, and `back` returns to the workspace.
 * The styles key off `html[data-navigation-motion]` (06-navigation.css).
 */
export type NavigationMotion = "switch" | "forward" | "replace" | "back";

let generation = 0;

const GLIDE_MS = 220;
const GLIDE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
/** How long a switch waits for the new view's rows before going ahead. */
const SETTLE_WAIT_MS = 160;

/**
 * Applies a route update inside a view transition when the platform supports
 * one and motion is allowed; otherwise applies it immediately.
 */
export function transitionNavigation(
  motion: NavigationMotion,
  update: () => void,
  { traversal = false }: { traversal?: boolean } = {},
): void {
  transition(motion, update, traversal);
}

/** Collapsing or expanding the sidebar moves the rail and the work together. */
export function transitionSidebar(update: () => void): void {
  transition("sidebar", update, false);
}

type Motion = NavigationMotion | "sidebar";

function transition(motion: Motion, update: () => void, traversal: boolean) {
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

function startTransition(motion: Motion, update: () => void) {
  const root = document.documentElement;
  const current = ++generation;
  root.dataset.navigationMotion = motion;
  // Animation frames do not run while the update is pending, so the commit,
  // and the focus and scroll restoration in its layout effects, is synchronous.
  const transition = document.startViewTransition(() => {
    glideWork(motion, () => flushSync(update));
    // The old view stays on screen until the new one has its rows, so a
    // switch does not pass through a loading state on the way.
    return motion === "switch" ? workSettled() : undefined;
  });
  // A newer navigation may skip this one; that is expected, not an error.
  transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (generation === current) delete root.dataset.navigationMotion;
    });
}

function workSurface(): HTMLElement | null {
  return document.querySelector<HTMLElement>("main.page-surface");
}

function workScreen(): HTMLElement | null {
  return workSurface()?.querySelector<HTMLElement>(":scope > .screen") ?? null;
}

/**
 * Beside the work, opening or closing task details changes the room the work
 * has, and so does the sidebar. The work glides to its new place rather than
 * jumping there. `commit` applies the change synchronously.
 */
function glideWork(motion: Motion, commit: () => void): void {
  const beside = motion === "forward" || motion === "back";
  if (
    (!beside && motion !== "sidebar") ||
    (beside && !window.matchMedia?.("(min-width: 1024px)").matches)
  ) {
    commit();
    return;
  }
  const before = workScreen()?.getBoundingClientRect().left;
  commit();
  // The route change may have rendered the work again as a new element.
  const work = workScreen();
  if (!work || before === undefined) return;
  if (typeof work.animate !== "function") return;
  const dx = before - work.getBoundingClientRect().left;
  if (Math.abs(dx) < 1) return;
  const timing = { duration: GLIDE_MS, easing: GLIDE_EASING };
  work.animate(
    [{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }],
    timing,
  );
  if (!beside) return;
  // The moving work stays inside its own column, clear of the details.
  work.parentElement?.animate(
    [{ clipPath: "inset(0)" }, { clipPath: "inset(0)" }],
    timing,
  );
}

/** Resolves once the new view shows its rows, or after a short wait. */
function workSettled(): Promise<void> | undefined {
  const surface = workSurface();
  if (!surface?.querySelector(".loading-rows")) return undefined;
  return new Promise((resolve) => {
    const settle = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (!surface.querySelector(".loading-rows")) settle();
    });
    observer.observe(surface, { childList: true, subtree: true });
    const timer = window.setTimeout(settle, SETTLE_WAIT_MS);
  });
}

export function navigationMotion(
  from: { page: string },
  to: { page: string },
): NavigationMotion {
  if (to.page === "task") return from.page === "task" ? "replace" : "forward";
  return from.page === "task" ? "back" : "switch";
}
