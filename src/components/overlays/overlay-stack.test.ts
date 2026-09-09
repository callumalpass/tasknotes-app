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
it("isolates the background and traps Tab at both ends of a modal", () => {
  const app = element("main");
  const trigger = element("button", app);
  trigger.focus();
  const dialog = element("section");
  const first = element("button", dialog);
  const last = element("button", dialog);
  const dismiss = vi.fn();
  disposals.push(
    registerOverlay({
      root: dialog,
      modal: true,
      dismiss,
      initialFocus: () => first,
    }),
  );
  expect(app.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  key("Tab", true);
  expect(document.activeElement).toBe(last);
  key("Tab");
  expect(document.activeElement).toBe(first);
  key("Escape");
  expect(dismiss).toHaveBeenCalledWith("escape");
});
it("gives a nested popup Escape ownership without dismissing its parent", async () => {
  const app = element("main");
  const trigger = element("button", app);
  trigger.focus();
  const parent = element("section");
  const date = element("button", parent);
  const parentDismiss = vi.fn();
  disposals.push(
    registerOverlay({ root: parent, modal: true, dismiss: parentDismiss }),
  );
  date.focus();
  const popup = element("div", parent);
  const day = element("button", popup);
  const childDismiss = vi.fn(() => remove());
  const remove = registerOverlay({
    root: popup,
    modal: false,
    dismiss: childDismiss,
    initialFocus: () => day,
  });
  disposals.push(remove);
  key("Escape");
  await Promise.resolve();
  expect(childDismiss).toHaveBeenCalledOnce();
  expect(parentDismiss).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(date);
  expect(app.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
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
