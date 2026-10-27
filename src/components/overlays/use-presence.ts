import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

// Longest exit in the motion tokens plus headroom; a stalled animation must
// never leave an inert overlay mounted.
const EXIT_LIMIT_MS = 600;

/**
 * Keeps a closed overlay mounted until its CSS exit animation finishes.
 *
 * Render the root with `data-state={open ? "open" : "closed"}` and make it
 * inert while closed. Registration with the overlay stack should still follow
 * `open`, so focus returns and isolation lifts the moment dismissal happens.
 * Without Web Animations support or with reduced motion, closing is immediate.
 */
export function usePresence(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onExited?: () => void,
): boolean {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open && exitMotionAvailable());
  }
  const exited = useRef(onExited);
  useLayoutEffect(() => {
    exited.current = onExited;
  });
  useLayoutEffect(() => {
    if (open || closing) return;
    exited.current?.();
  }, [open, closing]);
  useLayoutEffect(() => {
    if (!closing) return;
    // Reading animations flushes style, so the closed state's exit animation
    // is already running here and a cancelled entrance is no longer listed.
    const running =
      rootRef.current
        ?.getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState !== "finished" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        ) ?? [];
    if (!running.length) {
      setClosing(false);
      return;
    }
    let current = true;
    const finish = () => {
      if (current) setClosing(false);
    };
    void Promise.allSettled(
      running.map((animation) => animation.finished),
    ).then(finish);
    const limit = window.setTimeout(finish, EXIT_LIMIT_MS);
    return () => {
      current = false;
      window.clearTimeout(limit);
    };
  }, [closing, rootRef]);
  return open || closing;
}

/**
 * Retains the last open value of a value-driven overlay so it can render while
 * exiting. `key` changes for every newly opened value, so a reopened overlay
 * starts with fresh state; call `clear` from the overlay's exit callback.
 */
export function useExitingValue<T>(value: T | null | undefined): {
  value: T | null;
  key: number;
  clear(): void;
} {
  const [retained, setRetained] = useState<{ value: T; key: number } | null>(
    value == null ? null : { value, key: 0 },
  );
  if (value != null && value !== retained?.value)
    setRetained({ value, key: (retained?.key ?? 0) + 1 });
  const clear = useCallback(() => setRetained(null), []);
  return {
    value: value ?? retained?.value ?? null,
    key: retained?.key ?? 0,
    clear,
  };
}

function exitMotionAvailable(): boolean {
  return (
    typeof Element !== "undefined" &&
    typeof Element.prototype.getAnimations === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
