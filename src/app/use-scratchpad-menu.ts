import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
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
    const bounds = trigger.getBoundingClientRect();
    const anchorMoved = () => {
      const current = trigger.getBoundingClientRect();
      return (
        current.top !== bounds.top ||
        current.left !== bounds.left ||
        current.width !== bounds.width
      );
    };
    const scroll = (event: Event) => {
      if (
        (!(event.target instanceof Node) || !menu.contains(event.target)) &&
        anchorMoved()
      )
        close();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (anchorMoved()) close();
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

/** Opens a row's menu upwards when there is no room for it below. */
export function useMenuDirection(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const scrollBounds = trigger
      .closest(".scratchpad-history-scroll")
      ?.getBoundingClientRect();
    const roomAbove = bounds.top - Math.max(0, scrollBounds?.top ?? 0);
    const roomBelow =
      Math.min(window.innerHeight, scrollBounds?.bottom ?? window.innerHeight) -
      bounds.bottom;
    menu.classList.toggle(
      "opens-up",
      roomBelow < menu.offsetHeight + 8 && roomAbove > roomBelow,
    );
  }, [menuRef, open, triggerRef]);
}

const PHONE = "(max-width: 560px)";

function subscribeToPhoneWidth(listener: () => void) {
  const media = window.matchMedia?.(PHONE);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}

/**
 * Whether the feed is at phone width, where an earlier note's line has room
 * for its name but not for a labelled button beside it.
 */
export function usePhoneNoteLine(): boolean {
  return useSyncExternalStore(
    subscribeToPhoneWidth,
    () => Boolean(window.matchMedia?.(PHONE).matches),
    () => false,
  );
}
