import { fireEvent, render, screen } from "@testing-library/react";

import { Navigation, StorageErrorScreen } from "./app-shell";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";

import type { TaskView } from "../domain/view";

it("lets a user escape an unavailable remembered collection", () => {
  const authorizeAnotherCollection = vi.fn();
  const changeCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={changeCollection}
      error={new Error("The connector is offline.")}
      reauthorizeCurrentCollection={vi.fn()}
      retry={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose another mdbase collection",
    }),
  );

  expect(authorizeAnotherCollection).toHaveBeenCalledOnce();
  expect(changeCollection).not.toHaveBeenCalled();
});

it("separates reauthorizing the current collection from choosing another", () => {
  const authorizeAnotherCollection = vi.fn();
  const reauthorizeCurrentCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={vi.fn()}
      error={Object.assign(new Error("The grant expired."), {
        code: "authorization_expired",
      })}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      retry={vi.fn()}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Reconnect this collection" }),
  );
  expect(reauthorizeCurrentCollection).toHaveBeenCalledOnce();
  expect(authorizeAnotherCollection).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose another mdbase collection",
    }),
  );
  expect(authorizeAnotherCollection).toHaveBeenCalledOnce();
});

it("keeps additional views behind the mobile Views menu", () => {
  const onNavigate = vi.fn();
  const today = navigationView("today", "Today");
  const upcoming = navigationView("upcoming", "Upcoming");

  render(
    <Navigation
      active="search"
      homeViewKey={today.key}
      mode="mobile"
      navigationKeys={[
        today.key,
        SCRATCHPAD_NAVIGATION_KEY,
        SEARCH_NAVIGATION_KEY,
        upcoming.key,
      ]}
      views={[today, upcoming]}
      onNavigate={onNavigate}
    />,
  );

  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Today", "Scratchpad", "Views", "Settings"]);
  expect(screen.getByRole("button", { name: "Views" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Search" }));
  expect(onNavigate).toHaveBeenCalledWith({ page: "search" });
});

function navigationView(id: string, name: string): TaskView {
  return {
    key: `TaskNotes/Views/${id}.base#${id}`,
    documentId: id,
    documentName: id,
    id,
    name,
    properties: [],
    source: {
      path: `TaskNotes/Views/${id}.base`,
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: {},
    },
  };
}
