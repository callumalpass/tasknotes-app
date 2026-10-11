import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fuzzyScore,
  rankCommands,
  type PaletteCommand,
} from "./command-palette-model";
import { TASK_SHORTCUT_EVENT } from "./keyboard-shortcuts";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";
import {
  navigationCommands,
  paletteTaskTarget,
  taskCommands,
} from "./palette-commands";
import type { TaskView } from "../domain/view";

afterEach(() => {
  document.body.innerHTML = "";
});

const command = (
  id: string,
  section: PaletteCommand["section"],
  keywords?: string[],
): PaletteCommand => ({ id, label: id, section, keywords, run: vi.fn() });

describe("fuzzyScore", () => {
  it("matches subsequences and rejects missing characters", () => {
    expect(fuzzyScore("Calendar", "cal")).not.toBeNull();
    expect(fuzzyScore("Manage views", "mgv")).not.toBeNull();
    expect(fuzzyScore("Calendar", "cxl")).toBeNull();
    expect(fuzzyScore("Anything", "  ")).toBe(0);
  });

  it("prefers prefixes, word starts, and tight runs", () => {
    const prefix = fuzzyScore("Upcoming", "up")!;
    const wordStart = fuzzyScore("Look up", "up")!;
    const inside = fuzzyScore("Setup", "up")!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(fuzzyScore("Scheduled today", "sct")!).toBeGreaterThan(
      fuzzyScore("Search the catalogue", "sct")!,
    );
  });
});

describe("rankCommands", () => {
  const commands = [
    command("Today", "navigate"),
    command("Settings", "navigate", ["preferences"]),
    command("New task", "actions"),
    command("Complete", "task"),
  ];

  it("keeps section order and original order without a query", () => {
    expect(rankCommands(commands, "").map((item) => item.id)).toEqual([
      "Complete",
      "Today",
      "Settings",
      "New task",
    ]);
  });

  it("filters by label or keyword and sorts within a section", () => {
    expect(rankCommands(commands, "pref").map((item) => item.id)).toEqual([
      "Settings",
    ]);
    const ranked = rankCommands(
      [command("Calendar", "navigate"), command("Archive", "navigate")],
      "ar",
    );
    expect(ranked.map((item) => item.id)).toEqual(["Archive", "Calendar"]);
  });

  it("leads with the section holding the strongest match while searching", () => {
    expect(
      rankCommands(
        [command("Manage views", "navigate"), command("New task", "actions")],
        "new",
      ).map((item) => item.id),
    ).toEqual(["New task", "Manage views"]);
  });
});

describe("navigationCommands", () => {
  const views = [
    { key: "today", name: "Today" },
    { key: "board", name: "Work board" },
    { key: "archive", name: "Archive" },
  ] as TaskView[];

  it("covers navigation views, utility screens, and actions once each", () => {
    const navigate = vi.fn();
    const newTask = vi.fn();
    const showShortcuts = vi.fn();
    const commands = navigationCommands({
      navigationKeys: ["today", SEARCH_NAVIGATION_KEY, "archive"],
      views,
      homeKey: "today",
      navigate,
      newTask,
      showShortcuts,
    });
    expect(commands.map((item) => item.label)).toEqual([
      "Today",
      "Search",
      "Archive",
      "Scratchpad",
      "Work board",
      "Manage views",
      "Settings",
      "New task",
      "Keyboard shortcuts",
    ]);
    commands.find((item) => item.label === "Today")!.run();
    expect(navigate).toHaveBeenLastCalledWith({ page: "home" });
    commands.find((item) => item.label === "Work board")!.run();
    expect(navigate).toHaveBeenLastCalledWith({ page: "views", key: "board" });
    commands.find((item) => item.label === "Settings")!.run();
    expect(navigate).toHaveBeenLastCalledWith({ page: "more" });
    commands.find((item) => item.label === "Scratchpad")!.run();
    expect(navigate).toHaveBeenLastCalledWith({ page: "scratchpad" });
    commands.find((item) => item.label === "New task")!.run();
    expect(newTask).toHaveBeenCalledOnce();
    commands.find((item) => item.label === "Keyboard shortcuts")!.run();
    expect(showShortcuts).toHaveBeenCalledOnce();
    expect(
      commands.filter((item) => item.id === `go:${SCRATCHPAD_NAVIGATION_KEY}`),
    ).toHaveLength(0);
  });
});

describe("task commands", () => {
  function row(id: string, title: string, completed = false) {
    const element = document.createElement("div");
    element.className = "task-row";
    element.dataset.taskId = id;
    element.dataset.taskTitle = title;
    if (completed) element.dataset.taskCompleted = "true";
    element.innerHTML = `<button class="task-row-title">${title}</button>`;
    return element;
  }

  it("offers open, toggle, and date actions that ask the row to act", () => {
    const element = row("one", "Write brief");
    document.body.append(element);
    const requested = vi.fn();
    element.addEventListener(TASK_SHORTCUT_EVENT, (event) =>
      requested((event as CustomEvent).detail),
    );
    const commands = taskCommands(element);
    expect(commands.map((item) => item.label)).toEqual([
      "Open “Write brief”",
      "Complete “Write brief”",
      "Schedule today",
      "Schedule tomorrow",
      "Schedule next week",
    ]);
    for (const item of commands) item.run();
    expect(requested.mock.calls.flat()).toEqual([
      "open",
      "toggle",
      "today",
      "tomorrow",
      "next-week",
    ]);
  });

  it("omits open for the open task and says reopen when complete", () => {
    const labels = taskCommands(row("one", "Done", true), "one").map(
      (item) => item.label,
    );
    expect(labels[0]).toBe("Reopen “Done”");
    expect(labels).not.toContain("Open “Done”");
    expect(taskCommands(null)).toEqual([]);
  });

  it("does nothing once the row has left the page", () => {
    const element = row("one", "Gone");
    const requested = vi.fn();
    element.addEventListener(TASK_SHORTCUT_EVENT, requested);
    taskCommands(element)[1].run();
    expect(requested).not.toHaveBeenCalled();
  });

  it("targets the focused row, else the open task's row", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    const open = row("open", "Open task");
    const other = row("other", "Other");
    main.append(other, open);
    document.body.append(main);
    expect(
      paletteTaskTarget(other.querySelector("button"), { page: "home" }),
    ).toBe(other);
    expect(paletteTaskTarget(null, { page: "task", id: "open" })).toBe(open);
    expect(paletteTaskTarget(null, { page: "home" })).toBeNull();
  });
});
