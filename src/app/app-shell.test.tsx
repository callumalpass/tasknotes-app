import { fireEvent, render, screen, within } from "../test/render";
import { mdbaseError } from "@mdbase-dev/sdk";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";

import {
  DeletionFeedback,
  Navigation,
  StorageErrorScreen,
  ViewDiscoveryNotice,
} from "./app-shell";
import { SCRATCHPAD_NAVIGATION_KEY } from "./navigation-views";
import { OperationalError } from "../application/operational-error";
import { DuplicatePortableTaskIdentityError } from "../domain/tasknotes-model";

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

it("names view files discovery could not read instead of saying there are no views", () => {
  render(
    <ViewDiscoveryNotice
      outcome="empty"
      unreadableFiles={[
        {
          path: "TaskNotes/Views/tasks-default.base",
          reason: "view_metadata_unavailable",
          detail: "base_raw_frontmatter_unavailable",
        },
      ]}
      refreshing={false}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
      onStarterViewsAdded={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Couldn't read this file, so any views in it aren't shown:",
  );
  expect(screen.getByRole("listitem")).toHaveTextContent(
    "TaskNotes/Views/tasks-default.base",
  );
  expect(screen.getByRole("listitem")).toHaveTextContent(
    "Check that the file's YAML frontmatter is valid.",
  );
  expect(screen.queryByText("No views yet.")).toBeNull();
});

it("counts several unreadable view files alongside loaded views", () => {
  render(
    <ViewDiscoveryNotice
      outcome="ok"
      unreadableFiles={[
        ...["Views/a.base", "Views/b.base"].map((path) => ({
          path,
          reason: "view_unsupported_construct",
          detail: "unrecognized_projection",
        })),
        ...Array.from({ length: 188 }, (_, i) => ({
          path: `book-${i}.md`,
          reason: "view_metadata_unavailable",
          detail: "record_types_unresolved",
        })),
      ]}
      refreshing={false}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      /Files skipped because their types could not be resolved: 188/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/Couldn't read 2 files/)).toBeVisible();
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    "Views/a.base — unrecognized_projection",
    "Views/b.base — unrecognized_projection",
  ]);
});

it("says a view file is at fault when an older replica refuses all views", () => {
  render(
    <ViewDiscoveryNotice
      outcome="error"
      failure="unreadable_source"
      refreshing={false}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't load your views because a file in this collection can't be read.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("separates reviewing the current collection's access from choosing another", () => {
  const changeCollection = vi.fn();
  const reauthorizeCurrentCollection = vi.fn();

  render(
    <StorageErrorScreen
      changeCollection={changeCollection}
      error={mdbaseError("unauthenticated", "The grant expired.")}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      retry={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Review access" }));
  expect(reauthorizeCurrentCollection).toHaveBeenCalledOnce();
  expect(changeCollection).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: "Choose a different collection" }),
  );
  expect(changeCollection).toHaveBeenCalledOnce();
  expect(screen.queryByText("The grant expired.")).toBeNull();
});

it("shows conflicting file paths and resolution guidance on duplicate portable identity errors", () => {
  render(
    <StorageErrorScreen
      changeCollection={vi.fn()}
      error={
        new DuplicatePortableTaskIdentityError("task-123", [
          "Tasks/Buy milk (conflict).md",
          "Tasks/Buy milk.md",
        ])
      }
      reauthorizeCurrentCollection={vi.fn()}
      retry={vi.fn()}
    />,
  );

  expect(
    screen.getByText(/Tasks\/Buy milk \(conflict\)\.md/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Tasks\/Buy milk\.md/)).toBeInTheDocument();
  expect(
    screen.getByText(/Delete the duplicate copy or change its frontmatter/),
  ).toBeInTheDocument();
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

it("offers the open collection first in More on phones", async () => {
  const onNavigate = vi.fn();
  const mdbase = await createTestMdbase({ collections: [{ name: "Alpha" }] });
  await mdbase.select(mdbase.getSnapshot().collections[0]!.collectionId);

  render(
    <Navigation
      active="view:today"
      collectionUi={{ mdbase, app: { name: "TaskNotes" } }}
      mode="mobile"
      navigationKeys={[]}
      views={[]}
      onNavigate={onNavigate}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "More" }));
  const items = screen.getAllByRole("menuitem");
  expect(items[0]).toHaveTextContent("AlphaSwitch collection");
  fireEvent.click(items[0]!);
  expect(onNavigate).toHaveBeenLastCalledWith({
    page: "more",
    section: "collection",
  });
});

it("opens the mdbase apps from More on phones and returns focus to More", () => {
  render(
    <Navigation
      active="view:today"
      mdbaseApps={{ collectionId: "col_9" }}
      mode="mobile"
      navigationKeys={[]}
      views={[]}
      onNavigate={vi.fn()}
    />,
  );

  const more = screen.getByRole("button", { name: "More" });
  fireEvent.click(more);
  const row = screen.getByRole("menuitem", { name: "mdbase apps" });
  expect(row).toHaveAttribute("aria-haspopup", "menu");
  fireEvent.click(row);

  expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
  const apps = screen.getByRole("menu", { hidden: true });
  expect(apps).toHaveAttribute("aria-label", "mdbase apps");
  expect(apps).toHaveTextContent("Open this collection in");
  expect(
    within(apps).getByRole("menuitem", { name: /Editor/, hidden: true }),
  ).toHaveAttribute("href", expect.stringContaining("collection=col_9"));
  expect(apps.contains(document.activeElement)).toBe(true);
  expect(more).toHaveAttribute("aria-expanded", "true");

  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(more).toHaveAttribute("aria-expanded", "false");
});

it("leaves mdbase apps out of More where the switcher is hidden", () => {
  render(
    <Navigation
      active="view:today"
      mdbaseApps={null}
      mode="mobile"
      navigationKeys={[]}
      views={[]}
      onNavigate={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: "mdbase apps" })).toBeNull();
  expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Views");
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

it("names Today counts, reserves unknown badges, and preserves custom navigation order", () => {
  const today = { ...navigationView("today", "Today"), id: "today" };
  const custom = navigationView("custom", "My work");
  const hidden = navigationView("hidden", "Hidden work");
  const onNavigate = vi.fn();
  const component = (counts: { total: number; overdue: number } | null) => (
    <Navigation
      active="view:today"
      mode="desktop"
      homeKey={custom.key}
      navigationKeys={[custom.key, today.key]}
      views={[today, hidden, custom]}
      todayCounts={counts}
      onNavigate={onNavigate}
    />
  );
  const { rerender } = render(component(null));
  expect(
    screen
      .getByRole("button", { name: "Today" })
      .querySelector(".navigation-count"),
  ).toHaveClass("is-unknown");
  expect(screen.queryByRole("button", { name: "Hidden work" })).toBeNull();
  expect(
    screen
      .getAllByRole("button")
      .slice(0, 2)
      .map((button) => button.textContent?.trim()),
  ).toEqual(["My work", "Today 0"]);
  rerender(component({ total: 14, overdue: 12 }));
  // Label in name (WCAG 2.5.3): the name is the visible "Today 14".
  const badge = screen.getByRole("button", { name: "Today 14" });
  expect(badge).toHaveAttribute("title", "Today, 14 tasks, 12 overdue (g t)");
  fireEvent.click(badge);
  expect(onNavigate).toHaveBeenCalledWith({ page: "views", key: today.key });
});

it("keeps project identity and task counts accessible in the rail with focus tooltips", () => {
  render(
    <Navigation
      active="views"
      mode="desktop"
      navigationKeys={[]}
      views={[]}
      projects={[
        { label: "Product refresh", count: 10 },
        { label: "Field research", count: 1 },
      ]}
      onNavigate={vi.fn()}
    />,
  );
  const project = screen.getByRole("button", { name: "Product refresh 10" });
  expect(project.querySelector(".project-monogram")).toHaveAttribute(
    "data-monogram",
    "PR",
  );
  expect(project).toHaveAccessibleDescription("Product refresh, 10 tasks");
  const fieldResearch = screen.getByRole("button", {
    name: "Field research 1",
  });
  expect(fieldResearch.querySelector(".project-monogram")).toHaveAttribute(
    "data-monogram",
    "FR",
  );
  expect(fieldResearch).toHaveAccessibleDescription("Field research, 1 task");
  fireEvent.focus(project);
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Product refresh, 10 tasks",
  );
  expect(project).toHaveAccessibleDescription("Product refresh, 10 tasks");
  fireEvent.keyDown(project, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.mouseEnter(project);
  expect(screen.getByRole("tooltip")).toBeVisible();
  fireEvent.blur(project);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
