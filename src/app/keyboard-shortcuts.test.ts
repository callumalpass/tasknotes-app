import { afterEach, describe, expect, it, vi } from "vitest";

import { registerOverlay } from "../components/overlays/overlay-stack";
import {
  announceShortcut,
  focusAdjacentTaskRow,
  keyboardShortcutGroups,
  nextWeekStart,
  plainShortcutsSuspended,
  preserveRowFocus,
  shortcutSchedule,
  subscribeShortcutAnnouncements,
  taskRowShortcut,
} from "./keyboard-shortcuts";

afterEach(() => {
  document.body.innerHTML = "";
});

function keydown(key: string, init: KeyboardEventInit = {}, target?: Element) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

function rows(titles: string[], parent: Element = document.body) {
  const main = document.createElement("main");
  main.id = "main-content";
  main.innerHTML = titles
    .map(
      (title, index) =>
        `<div class="task-row" data-task-id="t${index}"><div class="task-row-content"><button class="task-row-title">${title}</button></div></div>`,
    )
    .join("");
  parent.append(main);
  return main;
}

describe("plain shortcut guards", () => {
  it("maps row keys and ignores shifted or unknown keys", () => {
    expect(taskRowShortcut(keydown("o"))).toBe("open");
    expect(taskRowShortcut(keydown("x"))).toBe("toggle");
    expect(taskRowShortcut(keydown("t"))).toBe("today");
    expect(taskRowShortcut(keydown("m"))).toBe("tomorrow");
    expect(taskRowShortcut(keydown("w"))).toBe("next-week");
    expect(taskRowShortcut(keydown("X", { shiftKey: true }))).toBeNull();
    expect(taskRowShortcut(keydown("d"))).toBeNull();
    expect(taskRowShortcut(keydown("Delete"))).toBeNull();
  });

  it("yields to modifiers, typing, composition, and handled events", () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"])
      expect(plainShortcutsSuspended(keydown("x", { [modifier]: true }))).toBe(
        true,
      );
    expect(plainShortcutsSuspended(keydown("x", { isComposing: true }))).toBe(
      true,
    );
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    document.body.append(input, editor, textbox);
    for (const target of [input, editor, textbox])
      expect(plainShortcutsSuspended(keydown("x", {}, target))).toBe(true);
    const handled = new KeyboardEvent("keydown", {
      key: "x",
      cancelable: true,
    });
    handled.preventDefault();
    expect(plainShortcutsSuspended(handled)).toBe(true);
    expect(plainShortcutsSuspended(keydown("x"))).toBe(false);
  });

  it("yields while any overlay is open", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const unregister = registerOverlay({
      root: layer,
      modal: false,
      dismiss: vi.fn(),
    });
    expect(taskRowShortcut(keydown("x"))).toBeNull();
    unregister();
    expect(taskRowShortcut(keydown("x"))).toBe("toggle");
  });
});

describe("date shortcuts", () => {
  it("starts next week on the configured first day", () => {
    // Wednesday 14 October 2026.
    expect(nextWeekStart("2026-10-14", 1)).toBe("2026-10-19");
    expect(nextWeekStart("2026-10-14", 0)).toBe("2026-10-18");
    expect(nextWeekStart("2026-10-14", 6)).toBe("2026-10-17");
    // On the first day itself, next week is a full week away.
    expect(nextWeekStart("2026-10-19", 1)).toBe("2026-10-26");
  });

  it("moves the day and keeps an existing time", () => {
    expect(shortcutSchedule("today", undefined, "2026-10-14")).toBe(
      "2026-10-14",
    );
    expect(shortcutSchedule("tomorrow", "2026-10-01", "2026-10-14")).toBe(
      "2026-10-15",
    );
    expect(shortcutSchedule("tomorrow", "2026-10-01T09:30", "2026-10-14")).toBe(
      "2026-10-15T09:30",
    );
    expect(shortcutSchedule("today", "2026-12-31T23:59", "2026-10-31")).toBe(
      "2026-10-31T23:59",
    );
  });
});

describe("row focus", () => {
  it("moves between visible rows and stops at the ends", () => {
    const main = rows(["One", "Two", "Three"]);
    const titles = [...main.querySelectorAll<HTMLElement>(".task-row-title")];
    main.children[1].setAttribute("hidden", "");
    expect(focusAdjacentTaskRow(1, null, main)).toBe(true);
    expect(titles[0]).toHaveFocus();
    expect(focusAdjacentTaskRow(1, titles[0], main)).toBe(true);
    expect(titles[2]).toHaveFocus();
    expect(focusAdjacentTaskRow(1, titles[2], main)).toBe(false);
    expect(titles[2]).toHaveFocus();
    expect(focusAdjacentTaskRow(-1, titles[2], main)).toBe(true);
    expect(titles[0]).toHaveFocus();
  });

  it("starts from the last row when moving up with nothing focused", () => {
    const main = rows(["One", "Two"]);
    focusAdjacentTaskRow(-1, null, main);
    expect(main.querySelectorAll(".task-row-title")[1]).toHaveFocus();
  });

  it("stays within the inspector when a row there is focused", () => {
    rows(["Main"]);
    const inspector = document.createElement("aside");
    inspector.className = "detail-inspector";
    inspector.innerHTML = `<div class="task-row" data-task-id="a"><button class="task-row-title">A</button></div><div class="task-row" data-task-id="b"><button class="task-row-title">B</button></div>`;
    document.body.append(inspector);
    const [a, b] = inspector.querySelectorAll<HTMLElement>(".task-row-title");
    expect(focusAdjacentTaskRow(1, a)).toBe(true);
    expect(b).toHaveFocus();
    expect(focusAdjacentTaskRow(1, b)).toBe(false);
  });

  it("returns focus to a neighbour when the acted-on row leaves the list", () => {
    const main = rows(["One", "Two", "Three"]);
    const [, middle] = main.querySelectorAll<HTMLElement>(".task-row");
    const restore = preserveRowFocus(middle);
    middle.remove();
    restore();
    expect(main.querySelectorAll(".task-row-title")[1]).toHaveTextContent(
      "Three",
    );
    expect(document.activeElement).toHaveTextContent("Three");
  });

  it("leaves focus alone when it is already somewhere meaningful", () => {
    const main = rows(["One", "Two"]);
    const [first] = main.querySelectorAll<HTMLElement>(".task-row");
    const restore = preserveRowFocus(first);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    first.remove();
    restore();
    expect(other).toHaveFocus();
  });
});

it("lists the global and row shortcuts, including new task and undo", () => {
  const descriptions = keyboardShortcutGroups().flatMap((group) =>
    group.shortcuts.map((shortcut) => shortcut.description),
  );
  expect(descriptions).toEqual(
    expect.arrayContaining([
      "Command palette",
      "New task",
      "Undo a deleted task",
      "Keyboard shortcuts",
      "Next task",
      "Complete or reopen",
      "Schedule next week",
    ]),
  );
});

it("delivers announcements to subscribers until they unsubscribe", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeShortcutAnnouncements(listener);
  announceShortcut("Completed Write brief.");
  unsubscribe();
  announceShortcut("Ignored");
  expect(listener).toHaveBeenCalledExactlyOnceWith("Completed Write brief.");
});
