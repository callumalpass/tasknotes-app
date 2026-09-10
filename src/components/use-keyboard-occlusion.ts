import { useEffect, useState } from "react";

/** Focus alone is not evidence of an onscreen keyboard (notably on iPad/hardware keyboards). */
export function useKeyboardOcclusion(): boolean {
  const [occluded, setOccluded] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    let baseline = window.innerHeight;
    let width = window.innerWidth;
    let frame = 0;
    const update = () => {
      const focused = document.activeElement;
      const editing =
        focused instanceof HTMLElement &&
        (focused.isContentEditable ||
          focused.matches(
            'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"])',
          ));
      if (!editing || width !== window.innerWidth)
        baseline = window.innerHeight;
      width = window.innerWidth;
      const overlay = viewport
        ? window.innerHeight - viewport.height - viewport.offsetTop
        : 0;
      const resized = window.matchMedia("(pointer: coarse)").matches
        ? baseline - window.innerHeight
        : 0;
      setOccluded(
        Boolean(
          editing &&
          (viewport?.scale ?? 1) === 1 &&
          Math.max(overlay, resized) > 120,
        ),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, []);
  return occluded;
}
