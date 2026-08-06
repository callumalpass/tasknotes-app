import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "../navigation-views";
import { TaskNotesCatalogEntries } from "./scratchpad-catalog-entry";

it("opens, pins, and unpins TaskNotes working screens", () => {
  const onOpenScratchpad = vi.fn();
  const onOpenSearch = vi.fn();
  const onToggleNavigation = vi.fn();

  render(
    <TaskNotesCatalogEntries
      navigationKeys={[SEARCH_NAVIGATION_KEY]}
      onOpenScratchpad={onOpenScratchpad}
      onOpenSearch={onOpenSearch}
      onToggleNavigation={onToggleNavigation}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Find tasks/ }));
  fireEvent.click(screen.getByRole("button", { name: /Shape an outline/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Search from navigation" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add Scratchpad to navigation" }),
  );

  expect(onOpenSearch).toHaveBeenCalledOnce();
  expect(onOpenScratchpad).toHaveBeenCalledOnce();
  expect(onToggleNavigation.mock.calls).toEqual([
    [SEARCH_NAVIGATION_KEY],
    [SCRATCHPAD_NAVIGATION_KEY],
  ]);
});
