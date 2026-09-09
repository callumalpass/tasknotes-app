export interface OverlayOptions {
  root: HTMLElement;
  modal: boolean;
  dismissOnTab?: "always" | "boundary";
  dismiss(reason: "escape" | "outside"): void;
  initialFocus?(): HTMLElement | null;
  returnFocus?: HTMLElement | null;
}
type Layer = OverlayOptions & { restore: boolean };
const layers: Layer[] = [];
const inertBefore = new Map<HTMLElement, boolean>();
let overflowBefore: string | undefined;

export function available(element: HTMLElement): boolean {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      node.inert ||
      getComputedStyle(node).display === "none" ||
      getComputedStyle(node).visibility === "hidden"
    )
      return false;
    if (
      node instanceof HTMLDetailsElement &&
      !node.open &&
      !node.querySelector("summary")?.contains(element)
    )
      return false;
  }
  return true;
}
function focusable(roots: HTMLElement[]) {
  const candidates = [
    ...new Set(
      roots.flatMap((root) => [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]',
        ),
      ]),
    ),
  ];
  return candidates
    .filter((el) => el.tabIndex >= 0 && available(el))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1,
    );
}
function restoreInert() {
  for (const [element, previous] of inertBefore) element.inert = previous;
  inertBefore.clear();
}
function lastModalIndex() {
  for (let index = layers.length - 1; index >= 0; index--)
    if (layers[index].modal) return index;
  return -1;
}
function synchronize() {
  restoreInert();
  const index = lastModalIndex();
  if (index < 0) {
    if (overflowBefore !== undefined)
      document.body.style.overflow = overflowBefore;
    overflowBefore = undefined;
    return;
  }
  if (overflowBefore === undefined)
    overflowBefore = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const roots = layers.slice(index).map((layer) => layer.root);
  const isolate = (parent: HTMLElement) => {
    for (const child of parent.children) {
      if (
        !(child instanceof HTMLElement) ||
        ["SCRIPT", "STYLE"].includes(child.tagName)
      )
        continue;
      if (roots.includes(child)) continue;
      if (roots.some((root) => child.contains(root))) isolate(child);
      else {
        inertBefore.set(child, child.inert);
        child.inert = true;
      }
    }
  };
  isolate(document.body);
}
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  const top = layers.at(-1);
  if (!top) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.dismiss("escape");
    return;
  }
  if (event.key !== "Tab") return;
  if (top.dismissOnTab) {
    const inside = focusable([top.root]);
    const boundary = event.shiftKey ? inside[0] : inside.at(-1);
    if (
      top.dismissOnTab === "always" ||
      document.activeElement === boundary ||
      !top.root.contains(document.activeElement)
    ) {
      const outside = focusable([document.body]).filter(
        (element) => !top.root.contains(element),
      );
      const origin = outside.indexOf(top.returnFocus as HTMLElement);
      const next =
        outside[origin + (event.shiftKey ? -1 : 1)] ??
        (event.shiftKey ? outside.at(-1) : outside[0]);
      top.restore = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      top.dismiss("outside");
      queueMicrotask(() => {
        if (next?.isConnected && available(next)) next.focus();
      });
      return;
    }
  }
  const index = lastModalIndex();
  if (index < 0) return;
  const elements = focusable(layers.slice(index).map((layer) => layer.root));
  const first = elements[0];
  const last = elements.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    layers[index].root.focus();
    return;
  }
  if (
    !elements.includes(active as HTMLElement) ||
    (event.shiftKey ? active === first : active === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
function pointerdown(event: PointerEvent) {
  const top = layers.at(-1);
  if (
    !top ||
    !(event.target instanceof Node) ||
    top.root.contains(event.target) ||
    top.returnFocus?.contains(event.target)
  )
    return;
  // Outside interaction should not move focus back over the user's new target.
  top.restore = false;
  top.dismiss("outside");
}

/** One owner for modal isolation, focus, scroll lock, and top-layer dismissal. */
export function registerOverlay(
  options: OverlayOptions,
): (restoreFocus?: boolean) => void {
  const layer: Layer = {
    ...options,
    returnFocus:
      options.returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
    restore: true,
  };
  if (!layers.length) {
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown);
  }
  // React mounts child effects before parents; don't put an ancestor above its popup.
  const descendant = layers.findIndex((existing) =>
    layer.root.contains(existing.root),
  );
  layers.splice(descendant < 0 ? layers.length : descendant, 0, layer);
  synchronize();
  layer.initialFocus?.()?.focus({ preventScroll: true });
  return (restoreFocus = true) => {
    if (!restoreFocus) layer.restore = false;
    const index = layers.indexOf(layer);
    if (index < 0) return;
    const wasTop = index === layers.length - 1;
    layers.splice(index, 1);
    synchronize();
    if (!layers.length) {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown);
    }
    if (wasTop && layer.restore)
      queueMicrotask(() => {
        const target = layer.returnFocus;
        if (target?.isConnected && available(target))
          target.focus({ preventScroll: true });
      });
  };
}
