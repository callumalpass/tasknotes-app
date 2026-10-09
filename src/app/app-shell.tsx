import {
  Columns3,
  FilePenLine,
  Plus,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { moveMenuFocus } from "@mdbase-dev/ui/popover";

import { CollectionAvailability } from "../components/collection-availability";
import { TaskAddedNotice } from "../components/task-added-notice";
import type { TaskSummary } from "../domain/task";
import { useKeyboardOcclusion } from "../components/use-keyboard-occlusion";
import { useSidebarReorder } from "./use-sidebar-reorder";
import { taskViewIcon } from "./views/view-icon";
import { useOverlay } from "../components/overlays/use-overlay";
import { LoadingRows } from "../components/loading";
import { GlobalTaskCapture } from "../components/global-task-capture";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { mdbaseNotifications } from "../native/mdbase-notifications";
import {
  useWorkspaceNavigation,
  type Route,
  type WorkspaceRoute,
} from "./use-workspace-navigation";
import { tasknotesMarkUrl } from "./assets";
import { isAuthorizationError, technicalErrorMessage } from "./auth-error";
import { useCollectionGate } from "./collection-context";
import { useRepository } from "./repository-context";
import { MoreScreen } from "./more-screen";
import { SearchScreen } from "./search-screen";
import { ScratchpadScreen } from "./scratchpad-screen";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";
import { TaskScreen } from "./task-screen";
import { useNavigationViews } from "./use-navigation-views";
import { ViewsScreen } from "./views-screen";
import { ModelSetupScreen } from "./model-setup-screen";
import { TaskNotesModelRequiredError } from "../application/ports/model-setup";
import {
  loadCalendarPreferences,
  saveCalendarPreferences,
  type CalendarPreferences,
} from "./calendar-preferences";

import type { TaskView } from "../domain/view";
import type { OperationalError } from "../application/operational-error";

export function AppShell() {
  const keyboardOccluded = useKeyboardOcclusion();
  const {
    repository,
    status,
    error,
    refresh,
    pendingDeletion,
    deletionError,
    undoTaskDeletion,
    retryTaskDeletion,
  } = useRepository();
  const {
    authorizeAnotherCollection,
    changeCollection,
    reauthorizeCurrentCollection,
  } = useCollectionGate();
  const {
    documents,
    views,
    error: viewsError,
    navigationViews,
    navigationKeys,
    homeKey,
    loading: viewsLoading,
    refresh: refreshViews,
    toggleNavigationView,
    moveNavigationView,
  } = useNavigationViews();
  const { route, workspaceRoute, navigate, detailRef } =
    useWorkspaceNavigation(navigationViews);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [addedNotice, setAddedNotice] = useState<{
    task: TaskSummary;
    repository: typeof repository;
    route: Route;
  }>();
  const reportAdded = (task: TaskSummary) =>
    setAddedNotice({ task, repository, route });
  const addedTask = addedNotice?.task;
  if (
    addedNotice &&
    (addedNotice.repository !== repository ||
      addedNotice.route !== route ||
      captureOpen ||
      pendingDeletion ||
      deletionError)
  ) {
    setAddedNotice(undefined);
  }
  const [calendarPreferences, setCalendarPreferences] =
    useState<CalendarPreferences>(loadCalendarPreferences);
  const updateCalendarPreferences = useCallback((next: CalendarPreferences) => {
    saveCalendarPreferences(next);
    setCalendarPreferences(next);
  }, []);
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const viewsCatalogOpen = route.page === "views" && !route.key;

  useEffect(() => {
    if (viewsCatalogOpen) void refreshViews();
  }, [refreshViews, viewsCatalogOpen]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "n" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      )
        return;
      event.preventDefault();
      setCaptureOpen(true);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    return mdbaseNotifications.listen(({ opened }) => {
      void refresh().catch(() => undefined);
      if (opened) navigate({ page: "home" }, true);
    });
  }, [navigate, refresh]);

  if (status === "opening") {
    return (
      <main className="opening-screen">
        <img alt="" src={tasknotesMarkUrl} />
        <p>Opening your tasks</p>
        <LoadingRows count={4} />
        <button
          className="text-action opening-change-collection"
          type="button"
          onClick={changeCollection}
        >
          Choose another mdbase collection
        </button>
      </main>
    );
  }
  if (status === "error") {
    if (error instanceof TaskNotesModelRequiredError && repository.modelSetup)
      return (
        <ModelSetupScreen
          setup={repository.modelSetup}
          onReady={refresh}
          changeCollection={changeCollection}
          reauthorizeCollection={reauthorizeCurrentCollection}
        />
      );
    return (
      <StorageErrorScreen
        authorizeAnotherCollection={authorizeAnotherCollection}
        changeCollection={changeCollection}
        error={error}
        reauthorizeCurrentCollection={reauthorizeCurrentCollection}
        retry={() => void refresh().catch(() => undefined)}
      />
    );
  }

  const workspace: WorkspaceRoute =
    route.page === "task" ? workspaceRoute : route;
  const workspacePage =
    workspace.page === "home"
      ? homeKey === SCRATCHPAD_NAVIGATION_KEY
        ? "scratchpad"
        : homeKey === SEARCH_NAVIGATION_KEY
          ? "search"
          : "view"
      : workspace.page;
  const workspaceViewKey =
    workspacePage === "view"
      ? homeKey
      : workspace.page === "views"
        ? workspace.key
        : undefined;
  const workspaceIsNavigationView = Boolean(
    workspaceViewKey &&
    navigationViews.some((view) => view.key === workspaceViewKey),
  );
  const showGlobalCaptureFab =
    !viewsLoading &&
    (workspacePage === "search" ||
      workspacePage === "view" ||
      Boolean(workspacePage === "views" && workspaceViewKey));
  const showBottomNavigation =
    route.page !== "task" &&
    !(workspace.page === "home" && viewsLoading) &&
    (workspacePage !== "views" ||
      !workspaceViewKey ||
      workspaceIsNavigationView);
  const activePage =
    workspaceViewKey && workspaceIsNavigationView
      ? `view:${workspaceViewKey}`
      : workspacePage === "views"
        ? "views"
        : workspacePage;
  return (
    <div
      className={`app-shell${route.page === "task" ? " has-detail" : ""}${keyboardOccluded ? " keyboard-occluded" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="navigation-rail" aria-label="Primary">
        <button
          className="wordmark"
          type="button"
          onClick={() => navigate({ page: "home" })}
        >
          <img alt="" src={tasknotesMarkUrl} />
          <span>TaskNotes</span>
        </button>
        <button
          aria-keyshortcuts="Control+N Meta+N"
          aria-label="New task"
          className="global-capture-navigation"
          type="button"
          onClick={() => setCaptureOpen(true)}
        >
          <Plus aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>New task</span>
          <kbd>⌘N</kbd>
        </button>
        <Navigation
          active={activePage}
          homeKey={homeKey}
          onMove={moveNavigationView}
          mode="desktop"
          navigationKeys={navigationKeys}
          views={views ?? []}
          onNavigate={navigate}
        />
      </aside>
      <main id="main-content" className="page-surface" tabIndex={-1}>
        {route.page !== "task" ? (
          <CollectionAvailability
            onSettings={
              workspacePage === "more"
                ? undefined
                : () => navigate({ page: "more" })
            }
          />
        ) : null}
        {workspacePage === "search" ? (
          <SearchScreen
            onBack={
              workspace.page === "home"
                ? undefined
                : () => navigate({ page: "home" }, true)
            }
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspacePage === "scratchpad" ? (
          <ScratchpadScreen
            onOpenTask={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspacePage === "more" ? (
          <MoreScreen
            calendarPreferences={calendarPreferences}
            onCalendarPreferencesChange={updateCalendarPreferences}
          />
        ) : workspace.page === "home" && viewsLoading ? (
          <HomeViewLoading />
        ) : workspacePage === "views" || workspacePage === "view" ? (
          <ViewsScreen
            onTaskAdded={reportAdded}
            calendarPreferences={calendarPreferences}
            documents={documents}
            error={viewsError}
            navigationViewKeys={navigationKeys}
            operational={workspaceIsNavigationView}
            views={views}
            viewKey={workspaceViewKey}
            onBack={() =>
              navigate(
                workspaceViewKey ? { page: "views" } : { page: "more" },
                true,
              )
            }
            onOpenTask={(task, occurrence) =>
              navigate({ page: "task", id: task.id, occurrence })
            }
            onSearch={() =>
              navigate(
                homeKey === SEARCH_NAVIGATION_KEY
                  ? { page: "home" }
                  : { page: "search" },
              )
            }
            onOpenView={(view) =>
              navigate(
                view.key === homeKey
                  ? { page: "home" }
                  : { page: "views", key: view.key },
              )
            }
            onOpenScratchpad={() =>
              navigate(
                homeKey === SCRATCHPAD_NAVIGATION_KEY
                  ? { page: "home" }
                  : { page: "scratchpad" },
              )
            }
            onToggleNavigationView={toggleNavigationView}
            onMoveNavigationView={moveNavigationView}
            onViewsChanged={refreshViews}
          />
        ) : null}
      </main>
      {route.page === "task" ? (
        <aside
          className="detail-inspector"
          aria-label="Task details"
          tabIndex={-1}
          ref={detailRef}
        >
          <CollectionAvailability
            onSettings={() => navigate({ page: "more" })}
          />
          <TaskScreen
            id={route.id}
            occurrenceDate={route.occurrence}
            onBack={() => {
              if (window.history.state?.taskPanel) window.history.back();
              else navigate(workspaceRoute, true);
            }}
            onMaterialized={(task) =>
              navigate({ page: "task", id: task.id }, true)
            }
          />
        </aside>
      ) : null}
      {showBottomNavigation ? (
        <nav
          className={`bottom-navigation items-${Math.min(navigationKeys.length, 2) + 2}`}
          aria-label="Primary"
        >
          <Navigation
            active={activePage}
            homeKey={homeKey}
            mode="mobile"
            navigationKeys={navigationKeys}
            views={views ?? []}
            onNavigate={navigate}
          />
        </nav>
      ) : null}
      {route.page !== "task" && showGlobalCaptureFab ? (
        <button
          aria-keyshortcuts="Control+N Meta+N"
          aria-label="New task"
          className="global-capture-fab"
          type="button"
          onClick={() => setCaptureOpen(true)}
        >
          <Plus aria-hidden="true" size={24} strokeWidth={1.8} />
          <span>Add task</span>
        </button>
      ) : null}
      <GlobalTaskCapture
        onAdded={reportAdded}
        open={captureOpen}
        onClose={closeCapture}
        onOpenTask={(task) => navigate({ page: "task", id: task.id })}
      />
      <TaskAddedNotice
        task={!pendingDeletion && !deletionError ? addedTask : undefined}
        onDismiss={() => setAddedNotice(undefined)}
        onOpen={(task) => navigate({ page: "task", id: task.id })}
        aboveMobileControls={
          route.page !== "task" &&
          (showBottomNavigation || showGlobalCaptureFab)
        }
      />
      <DeletionFeedback
        aboveMobileControls={
          route.page !== "task" &&
          (showBottomNavigation || showGlobalCaptureFab)
        }
        error={deletionError}
        pendingDeletion={pendingDeletion}
        onRetry={retryTaskDeletion}
        onUndo={undoTaskDeletion}
      />
    </div>
  );
}

export function DeletionFeedback({
  aboveMobileControls = false,
  error,
  pendingDeletion,
  onRetry,
  onUndo,
}: {
  aboveMobileControls?: boolean;
  error: OperationalError | null;
  pendingDeletion: {
    id: string;
    title: string;
    outcomeUnknown?: boolean;
  } | null;
  onRetry(): Promise<void>;
  onUndo(): Promise<void>;
}) {
  useEffect(() => {
    if (!pendingDeletion || pendingDeletion.outcomeUnknown) return;
    const undoShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "z" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      void onUndo().catch(() => undefined);
    };
    window.addEventListener("keydown", undoShortcut);
    return () => window.removeEventListener("keydown", undoShortcut);
  }, [onUndo, pendingDeletion]);

  if (error)
    return (
      <DeletionRecoveryNotice
        aboveMobileControls={aboveMobileControls}
        error={error}
        outcomeUnknown={pendingDeletion?.outcomeUnknown ?? false}
        title={pendingDeletion?.title}
        onRetry={pendingDeletion ? onRetry : undefined}
        onUndo={pendingDeletion ? onUndo : undefined}
      />
    );
  if (!pendingDeletion) return null;
  const positionClass = aboveMobileControls ? " is-above-mobile-controls" : "";
  return (
    <>
      <p aria-atomic="true" className="visually-hidden" role="status">
        Deleted “{pendingDeletion.title}”. Undo is available for 30 seconds.
      </p>
      <div className={`undo-toast${positionClass}`}>
        <span>Deleted “{pendingDeletion.title}”</span>
        <button
          aria-keyshortcuts="Control+Z Meta+Z"
          type="button"
          onClick={() => void onUndo().catch(() => undefined)}
        >
          Undo
        </button>
      </div>
    </>
  );
}

function DeletionRecoveryNotice({
  aboveMobileControls,
  error,
  outcomeUnknown,
  title,
  onRetry,
  onUndo,
}: {
  aboveMobileControls: boolean;
  error: OperationalError;
  outcomeUnknown: boolean;
  title?: string;
  onRetry?: () => Promise<void>;
  onUndo?: () => Promise<void>;
}) {
  const headingId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const positionClass = aboveMobileControls ? " is-above-mobile-controls" : "";
  return (
    <section
      aria-labelledby={headingId}
      className={`deletion-recovery-notice${positionClass}`}
    >
      <header>
        <h2 id={headingId}>
          {outcomeUnknown ? "Deletion needs review" : "Deletion waiting"}
        </h2>
        {title ? (
          <p>
            {outcomeUnknown
              ? `TaskNotes could not confirm whether “${title}” was deleted.`
              : `“${title}” is still in the collection.`}
          </p>
        ) : null}
      </header>
      <OperationErrorNotice
        action="The deletion"
        message={error}
        recovery={
          onRetry
            ? outcomeUnknown
              ? "Retry checks the saved request without sending a new deletion. Discard requires confirmation and disconnects this collection."
              : "Retry, or undo to restore the task here."
            : "The task remains in the collection. Try again."
        }
      />
      {onRetry && onUndo ? (
        <div className="deletion-recovery-actions">
          <button
            className="retry-deletion-action"
            type="button"
            onClick={() => void onRetry().catch(() => undefined)}
          >
            Retry
          </button>
          {outcomeUnknown && confirmDiscard ? (
            <>
              <p>
                Discarding removes all saved recovery and disconnects this
                collection. It does not reverse a deletion that may have
                completed.
              </p>
              <button
                type="button"
                onClick={() => void onUndo().catch(() => undefined)}
              >
                Confirm discard and disconnect
              </button>
              <button type="button" onClick={() => setConfirmDiscard(false)}>
                Keep saved recovery
              </button>
            </>
          ) : (
            <button
              aria-keyshortcuts={
                outcomeUnknown ? undefined : "Control+Z Meta+Z"
              }
              type="button"
              onClick={() =>
                outcomeUnknown
                  ? setConfirmDiscard(true)
                  : void onUndo().catch(() => undefined)
              }
            >
              {outcomeUnknown ? "Discard recovery" : "Undo"}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select, [role='textbox']"))
  );
}

export function StorageErrorScreen({
  authorizeAnotherCollection,
  changeCollection,
  error,
  reauthorizeCurrentCollection,
  retry,
}: {
  authorizeAnotherCollection(): void;
  changeCollection(): void;
  error: Error | null;
  reauthorizeCurrentCollection(): void;
  retry(): void;
}) {
  const authorizationExpired = isAuthorizationError(error);
  return (
    <main className="opening-screen storage-error">
      <img alt="" src={tasknotesMarkUrl} />
      <h1>
        {authorizationExpired
          ? "Reconnect to mdbase."
          : "TaskNotes could not open."}
      </h1>
      <p>
        {authorizationExpired
          ? "Your connection has expired. Reconnect to continue."
          : "The collection is unavailable right now."}
      </p>
      <div className="welcome-actions">
        {authorizationExpired ? (
          <>
            <button
              className="outline-action"
              type="button"
              onClick={reauthorizeCurrentCollection}
            >
              Reconnect this collection
            </button>
            <button
              className="text-action"
              type="button"
              onClick={authorizeAnotherCollection}
            >
              Choose another mdbase collection
            </button>
          </>
        ) : (
          <>
            <button className="outline-action" type="button" onClick={retry}>
              Try again
            </button>
            <button
              className="text-action"
              type="button"
              onClick={authorizeAnotherCollection}
            >
              Choose another mdbase collection
            </button>
          </>
        )}
        <button
          className="text-action"
          type="button"
          onClick={changeCollection}
        >
          Open a saved collection
        </button>
      </div>
      <details className="technical-details">
        <summary>Technical details</summary>
        <p>{technicalErrorMessage(error)}</p>
      </details>
    </main>
  );
}

function HomeViewLoading() {
  return (
    <section
      aria-busy="true"
      aria-labelledby="home-view-loading-title"
      className="screen views-screen view-detail"
    >
      <header className="view-header operational">
        <div>
          <h1 id="home-view-loading-title">Opening your view</h1>
          <small>Restoring your home view</small>
        </div>
      </header>
      <LoadingRows count={6} />
    </section>
  );
}

export function Navigation({
  active,
  homeKey,
  mode,
  navigationKeys,
  views,
  onNavigate,
  onMove,
}: {
  active: string;
  homeKey?: string;
  mode: "desktop" | "mobile";
  navigationKeys: string[];
  views: TaskView[];
  onNavigate(route: Route): void;
  onMove?(key: string, direction: -1 | 1): void;
}) {
  const navigationEntries: {
    key: string;
    navigationKey: string;
    label: string;
    icon: LucideIcon;
    route: Route;
  }[] = [];
  for (const key of navigationKeys) {
    if (key === SCRATCHPAD_NAVIGATION_KEY) {
      navigationEntries.push({
        key: "scratchpad",
        navigationKey: key,
        label: "Scratchpad",
        icon: FilePenLine,
        route: key === homeKey ? { page: "home" } : { page: "scratchpad" },
      });
      continue;
    }
    if (key === SEARCH_NAVIGATION_KEY) {
      navigationEntries.push({
        key: "search",
        navigationKey: key,
        label: "Search",
        icon: Search,
        route: key === homeKey ? { page: "home" } : { page: "search" },
      });
      continue;
    }
    const view = views.find((candidate) => candidate.key === key);
    if (view)
      navigationEntries.push({
        key: `view:${view.key}`,
        navigationKey: key,
        label: view.name,
        icon: taskViewIcon(view),
        route:
          view.key === homeKey
            ? { page: "home" }
            : { page: "views", key: view.key },
      });
  }
  const reorder = useSidebarReorder(
    navigationEntries.map((entry) => entry.navigationKey),
    mode === "desktop" ? onMove : undefined,
  );
  const visibleViews = navigationEntries.slice(0, 3);
  const additionalViews = navigationEntries.slice(visibleViews.length);
  const hiddenNavigationViewActive = additionalViews.some(
    (view) => active === view.key,
  );
  const items = visibleViews;
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useOverlay({
    open: Boolean(menuPosition),
    rootRef: menuRef,
    returnFocusRef: triggerRef,
    dismissOnTab: "always",
    onDismiss: closeMenu,
    initialFocus: () =>
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']") ??
      null,
  });
  useEffect(() => {
    if (!menuPosition) return;
    window.addEventListener("resize", closeMenu);
    return () => window.removeEventListener("resize", closeMenu);
  }, [menuPosition]);

  function openMenu() {
    if (menuPosition) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = Math.min(236, innerWidth - 16);
    const height = Math.min(
      (additionalViews.length + 2) * 46 + 16,
      innerHeight - 96,
    );
    const left =
      mode === "mobile"
        ? Math.max(
            8,
            Math.min(
              (rect?.left ?? innerWidth / 2) +
                (rect?.width ?? 0) / 2 -
                width / 2,
              innerWidth - width - 8,
            ),
          )
        : Math.min((rect?.right ?? 190) + 8, innerWidth - width - 8);
    const top =
      mode === "mobile"
        ? Math.max(8, (rect?.top ?? innerHeight) - height - 8)
        : Math.max(8, Math.min(rect?.top ?? 80, innerHeight - height - 8));
    setMenuPosition({ left, top });
  }

  function closeMenu() {
    setMenuPosition(null);
  }

  function choose(route: Route) {
    closeMenu();
    onNavigate(route);
  }

  return (
    <>
      {items.map(({ key, navigationKey, label, icon: Icon, route }) => (
        <button
          {...reorder.itemProps(navigationKey, label)}
          aria-current={active === key ? "page" : undefined}
          className={active === key ? "is-active" : undefined}
          key={key}
          title={mode === "desktop" ? label : undefined}
          type="button"
          onClick={() => onNavigate(route)}
        >
          <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
          <span>{label}</span>
        </button>
      ))}
      {mode === "desktop" ? (
        <div
          aria-label="Views"
          className="navigation-view-section"
          role="group"
        >
          {additionalViews.map((view) => {
            const Icon = view.icon;
            return (
              <button
                {...reorder.itemProps(view.navigationKey, view.label)}
                aria-current={active === view.key ? "page" : undefined}
                className={active === view.key ? "is-active" : undefined}
                key={view.key}
                title={view.label}
                type="button"
                onClick={() => onNavigate(view.route)}
              >
                <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
                <span>{view.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <button
            aria-controls={menuPosition ? menuId : undefined}
            aria-current={
              active === "views" ||
              active === "more" ||
              hiddenNavigationViewActive
                ? "page"
                : undefined
            }
            aria-expanded={Boolean(menuPosition)}
            aria-haspopup="menu"
            className={
              active === "views" ||
              active === "more" ||
              hiddenNavigationViewActive
                ? "is-active"
                : undefined
            }
            ref={triggerRef}
            type="button"
            onClick={openMenu}
          >
            <Columns3 aria-hidden="true" size={22} strokeWidth={1.7} />
            <span>Browse</span>
          </button>
          {menuPosition
            ? createPortal(
                <div
                  aria-label="Browse"
                  className="navigation-views-menu"
                  id={menuId}
                  ref={menuRef}
                  role="menu"
                  onKeyDown={(event) => moveMenuFocus(event, menuRef.current)}
                  style={menuPosition}
                >
                  {additionalViews.map((view) => {
                    const Icon = view.icon;
                    return (
                      <button
                        aria-current={active === view.key ? "page" : undefined}
                        key={view.key}
                        role="menuitem"
                        type="button"
                        onClick={() => choose(view.route)}
                      >
                        <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
                        <span>{view.label}</span>
                      </button>
                    );
                  })}
                  {additionalViews.length ? <hr /> : null}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => choose({ page: "views" })}
                  >
                    <Columns3 aria-hidden="true" size={19} strokeWidth={1.7} />
                    <span>Manage views</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => choose({ page: "more" })}
                  >
                    <Settings aria-hidden="true" size={19} strokeWidth={1.7} />
                    <span>Settings</span>
                  </button>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
      {mode === "desktop" ? (
        <p aria-live="polite" className="visually-hidden">
          {reorder.announcement}
        </p>
      ) : null}
      {mode === "desktop" ? (
        <div aria-label="Manage" className="navigation-utility" role="group">
          <button
            aria-current={active === "views" ? "page" : undefined}
            className={active === "views" ? "is-active" : undefined}
            type="button"
            onClick={() => onNavigate({ page: "views" })}
          >
            <Columns3 aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>Manage views</span>
          </button>
          <button
            aria-current={active === "more" ? "page" : undefined}
            className={active === "more" ? "is-active" : undefined}
            type="button"
            onClick={() => onNavigate({ page: "more" })}
          >
            <Settings aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>Settings</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
