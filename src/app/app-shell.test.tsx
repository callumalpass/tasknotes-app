import { fireEvent, render, screen } from "@testing-library/react";
import { connectError } from "@mdbase-dev/connect-testing";

import {
  DeletionFeedback,
  Navigation,
  StorageErrorScreen,
  ViewDiscoveryNotice,
} from "./app-shell-content";
import { SCRATCHPAD_NAVIGATION_KEY } from "./navigation-views";
import { OperationalError } from "../application/operational-error";

import type { TaskView } from "../domain/view";

it("keeps the view failure visible while retry is pending and prevents duplicate clicks", () => {
  const retry = vi.fn();
  render(
    <ViewDiscoveryNotice
      outcome="error"
      refreshing={true}
      onRetry={retry}
      onCreate={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't load your views.",
  );
  const button = screen.getByRole("button", { name: "Retrying…" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
});

it("separates reauthorizing the current collection from choosing another", () => {
  const authorizeAnotherCollection = vi.fn();
  const reauthorizeCurrentCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={vi.fn()}
      error={connectError("authorization_expired", "The grant expired.")}
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

it("routes a TaskNotes tool through Home when it is first", () => {
  const onNavigate = vi.fn();
  const today = navigationView("today", "Today");

  render(
    <Navigation
      active="scratchpad"
      homeKey={SCRATCHPAD_NAVIGATION_KEY}
      mode="desktop"
      navigationKeys={[SCRATCHPAD_NAVIGATION_KEY, today.key]}
      views={[today]}
      onNavigate={onNavigate}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Scratchpad" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ page: "home" });
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(onNavigate).toHaveBeenLastCalledWith({
    page: "views",
    key: today.key,
  });
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

it("explains restart-time unknown deletions without claiming the task remains", () => {
  render(
    <DeletionFeedback
      error={
        new OperationalError(
          "unknown",
          "delete-task",
          true,
          "The exact mdbase request is retained.",
        )
      }
      pendingDeletion={{
        id: "one",
        title: "Prepare the planning session",
        outcomeUnknown: true,
      }}
      onRetry={vi.fn(async () => undefined)}
      onUndo={vi.fn(async () => undefined)}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Deletion needs review" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "TaskNotes could not confirm whether “Prepare the planning session” was deleted.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Retry checks the saved request without sending a new deletion. Discard requires confirmation and disconnects this collection.",
  );
  expect(
    screen.getByRole("button", { name: "Discard recovery" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Discard recovery" }));
  expect(
    screen.getByRole("button", { name: "Confirm discard and disconnect" }),
  ).toBeVisible();
  expect(
    screen.queryByText("is still in the collection"),
  ).not.toBeInTheDocument();
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
