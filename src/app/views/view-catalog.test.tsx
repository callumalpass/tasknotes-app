import { fireEvent, render, screen, within } from "../../test/render";
import { expect, it, vi } from "vitest";

import type { TaskView, TaskViewDocument } from "../../domain/view";
import { SEARCH_NAVIGATION_KEY } from "../navigation-views";
import { ViewCatalog } from "./view-catalog";

it("leads directly from one counted heading and filters into saved views", () => {
  renderCatalog();
  const catalog = screen.getByRole("region", { name: "All views" });
  expect(within(catalog).getByLabelText("4 views shown")).toBeVisible();
  expect(
    within(catalog).queryByRole("heading", { name: "Saved views" }),
  ).toBeNull();
  expect(
    within(catalog).queryByText("Views stored in your collection"),
  ).toBeNull();
  fireEvent.change(
    within(catalog).getByRole("searchbox", { name: "Search views" }),
    {
      target: { value: "Work board" },
    },
  );
  expect(within(catalog).getByLabelText("1 views shown")).toBeVisible();
  expect(
    within(catalog).getByRole("button", { name: "Work board" }),
  ).toBeVisible();
});

it("keeps secondary view operations in a focused overflow menu", () => {
  const callbacks = renderCatalog();
  const allViews = screen.getByRole("region", { name: "All views" });
  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Work board",
    }),
  );

  const menu = screen.getByRole("menu", {
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
    screen.queryByRole("menu", { name: "Actions for Work board" }),
  ).toBeNull();

  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Work board",
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
  expect(callbacks.onDuplicate).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Work board" }),
  );

  fireEvent.click(
    within(allViews).getByRole("button", {
      name: "More actions for Today",
    }),
  );
  const readOnlyMenu = screen.getByRole("menu", {
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

it("keeps its portalled actions beside the trigger after navigation motion and scrolling", () => {
  renderCatalog();
  const trigger = screen.getByRole("button", {
    name: "More actions for Work board",
  });
  const rect = vi.spyOn(trigger, "getBoundingClientRect");
  rect.mockReturnValue({ bottom: 200, right: 800 } as DOMRect);
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "Actions for Work board" });
  expect(menu.style.top).toBe("204px");
  expect(menu.style.right).toBe(`${window.innerWidth - 800}px`);
  rect.mockReturnValue({ bottom: 300, right: 700 } as DOMRect);
  fireEvent.animationEnd(window.document.body);
  expect(menu.style.top).toBe("304px");
  expect(menu.style.right).toBe(`${window.innerWidth - 700}px`);
  rect.mockReturnValue({ bottom: 100, right: 700 } as DOMRect);
  fireEvent.scroll(window);
  expect(menu.style.top).toBe("104px");
});

it("uses view names for native source headings and keeps the portable path secondary", () => {
  renderCatalog(true);
  expect(
    screen.getByRole("heading", { name: "Today · Tomorrow" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "TaskNotes/Views/today.base" }),
  ).toBeNull();
  expect(
    screen.getAllByTitle("TaskNotes/Views/today.base").length,
  ).toBeGreaterThan(0);
});

function renderCatalog(rawSourceName = false) {
  const today = view("today", "Today", false, "TaskNotes/Views/today.base");
  const work = view("work", "Work board", true, "Views/work.base");
  const documents: TaskViewDocument[] = [document(today), document(work)];
  if (rawSourceName) {
    documents[0].name = today.source.path;
    documents[0].views.push({
      ...today,
      id: "tomorrow",
      key: `${today.source.path}#tomorrow`,
      name: "Tomorrow",
    });
  }
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
      views={documents.flatMap((entry) => entry.views)}
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
