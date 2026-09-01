import { FilePenLine, Search } from "lucide-react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "../navigation-views";
import { NavigationViewOrder } from "./navigation-view-order";

import type { TaskView } from "../../domain/view";

it("orders Search with saved views and other working screens", () => {
  const today = view("today", "Today");
  const upcoming = view("upcoming", "Upcoming");
  const onMove = vi.fn();

  render(
    <NavigationViewOrder
      keys={[
        today.key,
        SCRATCHPAD_NAVIGATION_KEY,
        SEARCH_NAVIGATION_KEY,
        upcoming.key,
      ]}
      specialViews={[
        {
          key: SCRATCHPAD_NAVIGATION_KEY,
          name: "Scratchpad",
          icon: FilePenLine,
        },
        { key: SEARCH_NAVIGATION_KEY, name: "Search", icon: Search },
      ]}
      views={[today, upcoming]}
      onMove={onMove}
    />,
  );

  expect(
    within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((item) => item.querySelector("span")?.textContent),
  ).toEqual(["TodayHome", "Scratchpad", "Search", "Upcoming"]);
  expect(
    screen.queryByRole("button", { name: "Move Scratchpad earlier" }),
  ).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
  expect(
    screen.getByRole("button", { name: "Move Scratchpad earlier" }),
  ).toBeEnabled();
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: "Move Search. Drag, or use up and down arrow keys.",
    }),
    { key: "ArrowUp" },
  );
  expect(onMove).toHaveBeenCalledWith(SEARCH_NAVIGATION_KEY, -1);
});

it("allows saved views and built-in tools to exchange the Home position", () => {
  const today = view("today", "Today");
  const upcoming = view("upcoming", "Upcoming");
  const onMove = vi.fn();

  render(
    <NavigationViewOrder
      keys={[
        today.key,
        SCRATCHPAD_NAVIGATION_KEY,
        upcoming.key,
        SEARCH_NAVIGATION_KEY,
      ]}
      specialViews={[
        {
          key: SCRATCHPAD_NAVIGATION_KEY,
          name: "Scratchpad",
          icon: FilePenLine,
        },
        { key: SEARCH_NAVIGATION_KEY, name: "Search", icon: Search },
      ]}
      views={[today, upcoming]}
      onMove={onMove}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
  fireEvent.click(screen.getByRole("button", { name: "Move Upcoming later" }));
  expect(onMove).toHaveBeenCalledWith(upcoming.key, 1);
  expect(
    screen.getByRole("button", { name: "Move Today later" }),
  ).toBeEnabled();
});

it("shows a pointer drop position and moves the view there", () => {
  const today = view("today", "Today");
  const upcoming = view("upcoming", "Upcoming");
  const onMove = vi.fn();
  const originalElementFromPoint = document.elementFromPoint;

  render(
    <NavigationViewOrder
      keys={[
        today.key,
        SCRATCHPAD_NAVIGATION_KEY,
        SEARCH_NAVIGATION_KEY,
        upcoming.key,
      ]}
      specialViews={[
        {
          key: SCRATCHPAD_NAVIGATION_KEY,
          name: "Scratchpad",
          icon: FilePenLine,
        },
        { key: SEARCH_NAVIGATION_KEY, name: "Search", icon: Search },
      ]}
      views={[today, upcoming]}
      onMove={onMove}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
  const source = screen.getByRole("button", {
    name: "Move Upcoming. Drag, or use up and down arrow keys.",
  });
  const target = screen
    .getByRole("button", {
      name: "Move Scratchpad. Drag, or use up and down arrow keys.",
    })
    .closest("li")!;
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 100, height: 54 }),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });

  fireEvent.pointerDown(source, { button: 0 });
  expect(source.closest("li")).toHaveClass("is-dragging");
  fireEvent.pointerMove(window, { clientX: 20, clientY: 105 });
  expect(target).toHaveClass("is-drop-before");
  fireEvent.pointerUp(window, { clientX: 20, clientY: 105 });

  expect(onMove).toHaveBeenCalledTimes(2);
  expect(onMove).toHaveBeenNthCalledWith(1, upcoming.key, -1);
  expect(onMove).toHaveBeenNthCalledWith(2, upcoming.key, -1);
  expect(target).not.toHaveClass("is-drop-before");
  expect(
    screen.getByText("Upcoming moved before Scratchpad."),
  ).toBeInTheDocument();

  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: originalElementFromPoint,
  });
});

it("allows a built-in tool to be dropped into the Home position", () => {
  const today = view("today", "Today");
  const onMove = vi.fn();
  const originalElementFromPoint = document.elementFromPoint;

  render(
    <NavigationViewOrder
      keys={[today.key, SCRATCHPAD_NAVIGATION_KEY]}
      specialViews={[
        {
          key: SCRATCHPAD_NAVIGATION_KEY,
          name: "Scratchpad",
          icon: FilePenLine,
        },
      ]}
      views={[today]}
      onMove={onMove}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
  const source = screen.getByRole("button", {
    name: "Move Scratchpad. Drag, or use up and down arrow keys.",
  });
  const target = screen
    .getByRole("button", {
      name: "Move Today. Drag, or use up and down arrow keys.",
    })
    .closest("li")!;
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 100, height: 54 }),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });

  fireEvent.pointerDown(source, { button: 0 });
  fireEvent.pointerMove(window, { clientX: 20, clientY: 105 });
  expect(target).toHaveClass("is-drop-before");
  fireEvent.pointerUp(window, { clientX: 20, clientY: 105 });
  expect(onMove).toHaveBeenCalledWith(SCRATCHPAD_NAVIGATION_KEY, -1);
  expect(
    screen.getByText("Scratchpad moved before Today."),
  ).toBeInTheDocument();

  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: originalElementFromPoint,
  });
});

function view(id: string, name: string): TaskView {
  const path = `TaskNotes/Views/${id}.base`;
  return {
    key: `${path}#${id}`,
    documentId: id,
    documentName: id,
    id,
    name,
    properties: [],
    source: {
      path,
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
  };
}
