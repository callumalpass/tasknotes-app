import { afterEach, expect, it, vi } from "vitest";
import { registerOverlay } from "./overlay-stack";
const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.reverse().forEach((dispose) => dispose());
  disposals.length = 0;
  document.body.innerHTML = "";
});
function element(tag: string, parent = document.body) {
  const node = document.createElement(tag);
  parent.append(node);
  return node;
}
function key(key: string, shiftKey = false) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}
it.each([false, true])(
  "Tab dismisses a menu and continues outside it (reverse: %s)",
  async (reverse) => {
    const before = element("button");
    const trigger = element("button");
    const after = element("button");
    const menu = element("div");
    const item = element("button", menu);
    const dismiss = vi.fn(() => remove());
    const remove = registerOverlay({
      root: menu,
      modal: false,
      dismissOnTab: "always",
      returnFocus: trigger,
      initialFocus: () => item,
      dismiss,
    });
    disposals.push(remove);
    key("Tab", reverse);
    await Promise.resolve();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(reverse ? before : after);
  },
);
it("a nonmodal dialog permits internal Tab but dismisses at its boundary", async () => {
  const trigger = element("button");
  const next = element("button");
  const popup = element("div");
  const first = element("button", popup);
  const last = element("button", popup);
  const dismiss = vi.fn(() => remove());
  const remove = registerOverlay({
    root: popup,
    modal: false,
    dismissOnTab: "boundary",
    returnFocus: trigger,
    initialFocus: () => first,
    dismiss,
  });
  disposals.push(remove);
  key("Tab");
  expect(dismiss).not.toHaveBeenCalled();
  last.focus();
  key("Tab");
  await Promise.resolve();
  expect(document.activeElement).toBe(next);
});
it.each([false, true])(
  "restores covered controls across nested modal isolation (initial inert: %s)",
  (initial) => {
    const grid = element("div");
    grid.inert = initial;
    const toolbar = element("button");
    const popup = element("div");
    const releasePopup = registerOverlay({
      root: popup,
      modal: false,
      inertRoots: [grid],
      dismiss: vi.fn(),
    });
    disposals.push(releasePopup);
    expect(grid.inert).toBe(true);
    expect(toolbar.inert).not.toBe(true);
    const dialog = element("div");
    const releaseDialog = registerOverlay({
      root: dialog,
      modal: true,
      dismiss: vi.fn(),
    });
    disposals.push(releaseDialog);
    releaseDialog();
    expect(grid.inert).toBe(true);
    releasePopup();
    expect(grid.inert).toBe(initial);
  },
);
it("retires an imperative popup before another overlay and transfers return focus", async () => {
  const trigger = element("button");
  const popup = element("div");
  const item = element("button", popup);
  const dismiss = vi.fn(() => releasePopup(false));
  const releasePopup = registerOverlay({
    root: popup,
    modal: false,
    dismissOnCover: true,
    dismiss,
    returnFocus: trigger,
    initialFocus: () => item,
  });
  disposals.push(releasePopup);
  const dialog = element("div");
  const field = element("input", dialog);
  const releaseDialog = registerOverlay({
    root: dialog,
    modal: true,
    dismiss: vi.fn(),
    initialFocus: () => field,
  });
  disposals.push(releaseDialog);
  expect(dismiss).toHaveBeenCalledWith("outside");
  expect(document.activeElement).toBe(field);
  releaseDialog();
  await Promise.resolve();
  expect(document.activeElement).toBe(trigger);
});
it("respects handled Escape and preserves an existing inert/scroll state", () => {
  document.body.style.overflow = "clip";
  const app = element("main");
  app.inert = true;
  const dialog = element("section");
  const input = element("input", dialog);
  const dismiss = vi.fn();
  const remove = registerOverlay({ root: dialog, modal: true, dismiss });
  disposals.push(remove);
  input.addEventListener("keydown", (e) => e.preventDefault());
  input.focus();
  key("Escape");
  expect(dismiss).not.toHaveBeenCalled();
  remove();
  expect(app.inert).toBe(true);
  expect(document.body.style.overflow).toBe("clip");
});
