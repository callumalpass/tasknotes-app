import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

const DURATION_MS = 220;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
// Past this many simultaneous moves the motion stops orienting and starts
// costing frames, so large reflows settle instantly instead.
const MAX_ANIMATED = 60;

interface Point {
  x: number;
  y: number;
}

/**
 * Glides keyed items from their previous position when the rendered order or
 * membership changes (a reschedule, completion, or section move), so the eye
 * can follow where a task went. Layout-only re-renders, such as a width
 * change while the detail pane opens, update positions without moving.
 *
 * Items are matched by `attribute` rather than DOM node, so a task React
 * remounts in another section still animates from where it was.
 */
export function useFlipMotion(
  container: RefObject<HTMLElement | null>,
  attribute: string,
  enabled = true,
) {
  const positions = useRef(new Map<string, Point>());
  const signature = useRef("");

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)];
    const origin = root.getBoundingClientRect();
    const nextSignature = items
      .map((item) => item.getAttribute(attribute))
      .join("\n");
    const animate =
      enabled &&
      signature.current !== "" &&
      nextSignature !== signature.current &&
      !prefersReducedMotion();
    const next = new Map<string, Point>();
    const moves: { item: HTMLElement; dx: number; dy: number }[] = [];
    for (const item of items) {
      const key = item.getAttribute(attribute);
      if (!key) continue;
      // Measure true layout, not an interrupted glide's transform.
      if (animate) for (const running of animationsOf(item)) running.cancel();
      const bounds = item.getBoundingClientRect();
      // Content coordinates, so scrolling a board between renders is not a move.
      const point = {
        x: bounds.left - origin.left + root.scrollLeft,
        y: bounds.top - origin.top + root.scrollTop,
      };
      next.set(key, point);
      const previous = positions.current.get(key);
      if (!animate || !previous) continue;
      const dx = previous.x - point.x;
      const dy = previous.y - point.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      if (!nearViewport(bounds, dy)) continue;
      moves.push({ item, dx, dy });
    }
    positions.current = next;
    signature.current = nextSignature;
    if (moves.length > MAX_ANIMATED) return;
    for (const { item, dx, dy } of moves) {
      if (typeof item.animate !== "function") continue;
      item.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: DURATION_MS, easing: EASING },
      );
    }
  });
}

function animationsOf(item: HTMLElement): Animation[] {
  return typeof item.getAnimations === "function" ? item.getAnimations() : [];
}

/** Either end of the glide must be on screen for the motion to orient. */
function nearViewport(bounds: DOMRect, dy: number): boolean {
  const height = window.innerHeight;
  const startTop = bounds.top + dy;
  const onScreen = (top: number) => top + bounds.height > 0 && top < height;
  return onScreen(bounds.top) || onScreen(startTop);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
