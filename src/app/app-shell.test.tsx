import { fireEvent, render, screen } from "@testing-library/react";

import { DeletionFeedback, Navigation, StorageErrorScreen } from "./app-shell";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";
import { OperationalError } from "../application/operational-error";

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

it("announces a pending deletion without putting Undo inside the live region", () => {
  render(
    <DeletionFeedback
      error={null}
      pendingDeletion={{ id: "one", title: "Prepare the planning session" }}
      onRetry={vi.fn(async () => undefined)}
      onUndo={vi.fn(async () => undefined)}
    />,
  );

  const status = screen.getByRole("status");
  const undo = screen.getByRole("button", { name: "Undo" });
  expect(status).toHaveTextContent(
    "Deleted “Prepare the planning session”. Undo is available for 30 seconds.",
  );
  expect(status.contains(undo)).toBe(false);
  expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
});

it("supports the deletion undo shortcut without overriding text editing", () => {
  const onUndo = vi.fn(async () => undefined);
  render(
    <>
      <input aria-label="Task title" />
      <DeletionFeedback
        error={null}
        pendingDeletion={{ id: "one", title: "Prepare the planning session" }}
        onRetry={vi.fn(async () => undefined)}
        onUndo={onUndo}
      />
    </>,
  );

  fireEvent.keyDown(screen.getByRole("textbox", { name: "Task title" }), {
    key: "z",
    ctrlKey: true,
  });
  expect(onUndo).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: "z", metaKey: true });
  expect(onUndo).toHaveBeenCalledOnce();
});

it("presents deletion failures as a persistent recovery notice", () => {
  const onRetry = vi.fn(async () => undefined);
  const onUndo = vi.fn(async () => undefined);
  render(
    <DeletionFeedback
      error={
        new OperationalError(
          "unavailable",
          "delete-task",
          true,
          "The collection is offline.",
        )
      }
      pendingDeletion={{ id: "one", title: "Prepare the planning session" }}
      onRetry={onRetry}
      onUndo={onUndo}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Deletion waiting" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "“Prepare the planning session” is still in the collection.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The deletion could not finish while the collection was unavailable. Retry, or undo to restore the task here.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(onUndo).toHaveBeenCalledOnce();
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
