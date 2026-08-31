import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { TaskView, TaskViewDocument } from "../../domain/view";
import { SEARCH_NAVIGATION_KEY } from "../navigation-views";
import { ViewCatalog } from "./view-catalog";

it("clearly separates navigation, tools, and saved views", () => {
  const callbacks = renderCatalog();
  const allViews = screen.getByRole("region", { name: "All views" });

  expect(
    screen.getByRole("heading", { name: "Shown in navigation" }),
  ).toBeVisible();
  expect(
    within(allViews).getByRole("heading", { name: "TaskNotes tools" }),
  ).toBeVisible();
  expect(
    within(allViews).getByRole("heading", { name: "Saved views" }),
  ).toBeVisible();
  expect(within(allViews).getByText("Views/work.base")).toBeVisible();
  expect(
    within(allViews).getByRole("button", {
      name: "Today must remain in navigation until another saved view is added",
    }),
  ).toHaveTextContent("In navigation");
  expect(
    within(allViews).getByRole("button", {
      name: "Add Work board to navigation",
    }),
  ).toHaveTextContent("Add");

  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "Add Work board to navigation",
    }),
  );
  expect(callbacks.onToggleNavigation).toHaveBeenCalledWith(
    "Views/work.base#work",
  );
});

it("searches the catalog and exposes useful filter counts", () => {
  renderCatalog();
  const allViews = screen.getByRole("region", { name: "All views" });

  expect(within(allViews).getByRole("button", { name: "All 4" })).toBeVisible();
  expect(
    within(allViews).getByRole("button", { name: "In navigation 2" }),
  ).toBeVisible();
  expect(
    within(allViews).getByRole("button", { name: "Editable 1" }),
  ).toBeVisible();

  fireEvent.change(
    within(allViews).getByRole("searchbox", { name: "Search views" }),
    {
      target: { value: "work.base" },
    },
  );
  expect(within(allViews).getByRole("button", { name: "All 1" })).toBeVisible();
  expect(within(allViews).getByText("Work board")).toBeVisible();
  expect(within(allViews).queryByText("Today")).toBeNull();

  fireEvent.click(
    within(allViews).getByRole("button", { name: "In navigation 0" }),
  );
  expect(within(allViews).getByText("No matching views")).toBeVisible();
});

it("keeps secondary view operations in a focused overflow menu", () => {
  const callbacks = renderCatalog();
  const allViews = screen.getByRole("region", { name: "All views" });
  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Work board",
    }),
  );

  const menu = within(allViews).getByRole("menu", {
    name: "Actions for Work board",
  });
  expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  const duplicate = within(menu).getByRole("menuitem", { name: "Duplicate" });
  expect(duplicate).toBeVisible();
  expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeVisible();
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(duplicate).toHaveFocus();
  fireEvent.keyDown(duplicate, { key: "Tab" });
  expect(
    within(allViews).queryByRole("menu", { name: "Actions for Work board" }),
  ).toBeNull();

  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Work board",
    }),
  );
  fireEvent.click(
    within(allViews).getByRole("menuitem", { name: "Duplicate" }),
  );
  expect(callbacks.onDuplicate).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Work board" }),
  );

  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Today",
    }),
  );
  const readOnlyMenu = within(allViews).getByRole("menu", {
    name: "Actions for Today",
  });
  expect(
    within(readOnlyMenu).queryByRole("menuitem", { name: "Edit" }),
  ).toBeNull();
  expect(
    within(readOnlyMenu).queryByRole("menuitem", { name: "Delete" }),
  ).toBeNull();
  expect(
    within(readOnlyMenu).getByRole("menuitem", { name: "Duplicate" }),
  ).toBeVisible();
});

function renderCatalog() {
  const today = view("today", "Today", false, "TaskNotes/Views/today.base");
  const work = view("work", "Work board", true, "Views/work.base");
  const documents: TaskViewDocument[] = [document(today), document(work)];
  const callbacks = {
    onOpenScratchpad: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenView: vi.fn(),
    onToggleNavigation: vi.fn(),
    onMoveNavigation: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <ViewCatalog
      documents={documents}
      navigationViewKeys={[today.key, SEARCH_NAVIGATION_KEY]}
      views={[today, work]}
      {...callbacks}
    />,
  );
  return callbacks;
}

function view(
  id: string,
  name: string,
  writable: boolean,
  path: string,
): TaskView {
  return {
    key: `${path}#${id}`,
    documentId: id,
    documentName: name,
    id,
    name,
    properties: [],
    source: {
      path,
      format: "obsidian.base",
      revision: "one",
      writable,
    },
  };
}

function document(view: TaskView): TaskViewDocument {
  return {
    id: view.documentId,
    name: view.documentName,
    source: view.source,
    views: [view],
  };
}
