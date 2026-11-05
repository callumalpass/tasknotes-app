import { useLayoutEffect, useRef, type RefObject } from "react";
import { registerOverlay } from "../components/overlays/overlay-stack";

export function useScratchpadMenu(
  identity: string | boolean | undefined,
  menuRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!identity || !menu || !trigger) return;
    const close = () => closeRef.current();
    const release = registerOverlay({
      root: menu,
      modal: false,
      dismissOnCover: true,
      dismissOnTab: "boundary",
      dismiss: close,
      initialFocus: () => menu.querySelector<HTMLButtonElement>("button"),
      returnFocus: trigger,
    });
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.contains(event.target))
        close();
    };
    const bounds = trigger.getBoundingClientRect();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            const current = trigger.getBoundingClientRect();
            if (
              current.top !== bounds.top ||
              current.left !== bounds.left ||
              current.width !== bounds.width
            )
              close();
          });
    observer?.observe(trigger.closest(".scratchpad-history-scroll") ?? trigger);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
      release();
    };
  }, [identity, menuRef, triggerRef]);
}
