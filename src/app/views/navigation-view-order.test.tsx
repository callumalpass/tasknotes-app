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
  ).toBeDisabled();
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Drag Search to reorder" }),
    { key: "ArrowUp" },
  );
  expect(onMove).toHaveBeenCalledWith(SEARCH_NAVIGATION_KEY, -1);
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
