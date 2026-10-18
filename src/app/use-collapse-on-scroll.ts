import { useEffect, useState } from "react";

/** Scroll distance that counts as a deliberate direction, not jitter. */
const DIRECTION_THRESHOLD = 8;
/** Content near the top never hides a floating label. */
const TOP_ALLOWANCE = 64;
const SETTLE_MS = 600;

/**
 * True while the page is being scrolled down, so a floating action can
 * shrink to its icon and uncover rows beneath it. Scrolling up, settling,
 * or returning to the top restores it.
 */
export function useCollapseOnScroll(): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    let settle = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last;
      if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
      last = y;
      setCollapsed(delta > 0 && y > TOP_ALLOWANCE);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        last = window.scrollY;
        setCollapsed(false);
      }, SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, []);
  return collapsed;
}
