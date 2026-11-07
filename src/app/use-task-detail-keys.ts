import { useEffect, useRef } from "react";
import { plainShortcutsSuspended } from "./keyboard-shortcuts";

/** Escape leaves through the safe path; j/k step between tasks. Both run
 * ahead of the global list handlers. */
export function useTaskDetailKeys(handlers: {
  onEscape(): void;
  onNavigate?(direction: number): void;
}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Ignore Alt solely for the alternate navigation keys. Every other
      // suspension rule (typing, IME, overlays, modifiers) still applies.
      const alternate =
        event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
      if (
        event.shiftKey ||
        event.repeat ||
        plainShortcutsSuspended(event, alternate)
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        latest.current.onEscape();
        return;
      }
      const direction =
        event.key === "j" || (alternate && event.key === "ArrowDown")
          ? 1
          : event.key === "k" || (alternate && event.key === "ArrowUp")
            ? -1
            : 0;
      const { onNavigate } = latest.current;
      if (!direction || !onNavigate) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onNavigate(direction);
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);
}
