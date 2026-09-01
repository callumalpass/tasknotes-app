import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  CalendarDays,
  ChartNoAxesGantt,
  CheckCircle2,
  Columns3,
  FilePenLine,
  List,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LoadingRows } from "../components/loading";
import { GlobalTaskCapture } from "../components/global-task-capture";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { mdbaseNotifications } from "../native/mdbase-notifications";
import { nativeBackAction } from "../native/navigation";
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
import {
  loadCalendarPreferences,
  saveCalendarPreferences,
  type CalendarPreferences,
} from "./calendar-preferences";

import type { TaskView } from "../domain/view";
import type { OperationalError } from "../application/operational-error";

type Route =
  | { page: "home" | "search" | "scratchpad" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };
type WorkspaceRoute = Exclude<Route, { page: "task" }>;

export function AppShell() {
  const {
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
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [captureOpen, setCaptureOpen] = useState(false);
  const [calendarPreferences, setCalendarPreferences] =
    useState<CalendarPreferences>(loadCalendarPreferences);
  const updateCalendarPreferences = useCallback((next: CalendarPreferences) => {
    saveCalendarPreferences(next);
    setCalendarPreferences(next);
  }, []);
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const [workspaceRoute, setWorkspaceRoute] = useState<WorkspaceRoute>(() => {
    const initial = parseRoute();
    return initial.page === "task" ? { page: "home" } : initial;
  });
  const viewsCatalogOpen = route.page === "views" && !route.key;

  useEffect(() => {
    if (viewsCatalogOpen) void refreshViews();
  }, [refreshViews, viewsCatalogOpen]);

  useEffect(() => {
    const pop = () => {
      const next = parseRoute();
      setRoute(next);
      if (next.page !== "task") setWorkspaceRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

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

  const navigate = useCallback(
    (next: Route, replace = false) => {
      const url = routeUrl(next);
      const state = next.page === "task" ? { taskPanel: true } : null;
      if (replace) window.history.replaceState(state, "", url);
      else window.history.pushState(state, "", url);
      if (next.page === "task") {
        if (route.page !== "task") setWorkspaceRoute(route);
      } else {
        setWorkspaceRoute(next);
      }
      setRoute(next);
      if (next.page !== "task") window.scrollTo({ top: 0, left: 0 });
    },
    [route],
  );
  const routeRef = useRef(route);
  const navigateRef = useRef(navigate);
  const navigationViewKeysRef = useRef(navigationViews.map((view) => view.key));
  useEffect(() => {
    routeRef.current = route;
    navigateRef.current = navigate;
    navigationViewKeysRef.current = navigationViews.map((view) => view.key);
  }, [navigate, navigationViews, route]);

  useEffect(() => {
    return mdbaseNotifications.listen(({ opened }) => {
      void refresh().catch(() => undefined);
      if (opened) navigate({ page: "home" }, true);
    });
  }, [navigate, refresh]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("backButton", () => {
      const action = nativeBackAction(
        routeRef.current,
        navigationViewKeysRef.current,
      );
      if (action === "back") window.history.back();
      else if (action === "home") navigateRef.current({ page: "home" }, true);
      else void CapacitorApp.exitApp();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else remove = () => handle.remove();
    });
    return () => {
      disposed = true;
      void remove?.();
    };
  }, []);

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
    return (
      <StorageErrorScreen
        authorizeAnotherCollection={authorizeAnotherCollection}
        changeCollection={changeCollection}
        error={error}
        reauthorizeCurrentCollection={reauthorizeCurrentCollection}
        retry={() => void refresh()}
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
    <div className={`app-shell${route.page === "task" ? " has-detail" : ""}`}>
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
          mode="desktop"
          navigationKeys={navigationKeys}
          views={views ?? []}
          onNavigate={navigate}
        />
      </aside>
      <main id="main-content" className="page-surface">
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
            onNewTask={() => setCaptureOpen(true)}
          />
        ) : workspace.page === "home" && viewsLoading ? (
          <HomeViewLoading />
        ) : workspacePage === "views" || workspacePage === "view" ? (
          <ViewsScreen
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
        <aside className="detail-inspector" aria-label="Task details">
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
        open={captureOpen}
        onClose={closeCapture}
        onOpenTask={(task) => navigate({ page: "task", id: task.id })}
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
}: {
  active: string;
  homeKey?: string;
  mode: "desktop" | "mobile";
  navigationKeys: string[];
  views: TaskView[];
  onNavigate(route: Route): void;
}) {
  const navigationEntries: {
    key: string;
    label: string;
    icon: typeof CheckCircle2;
    route: Route;
  }[] = [];
  for (const key of navigationKeys) {
    if (key === SCRATCHPAD_NAVIGATION_KEY) {
      navigationEntries.push({
        key: "scratchpad",
        label: "Scratchpad",
        icon: FilePenLine,
        route: key === homeKey ? { page: "home" } : { page: "scratchpad" },
      });
      continue;
    }
    if (key === SEARCH_NAVIGATION_KEY) {
      navigationEntries.push({
        key: "search",
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
        label: view.name,
        icon: navigationViewIcon(view),
        route:
          view.key === homeKey
            ? { page: "home" }
            : { page: "views", key: view.key },
      });
  }
  const visibleViews = navigationEntries.slice(0, mode === "mobile" ? 2 : 3);
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

  useEffect(() => {
    if (!menuPosition) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        closeMenu();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const choices = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role='menuitem']",
        ) ?? []),
      ];
      if (!choices.length) return;
      const current = choices.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? choices.length - 1
            : event.key === "ArrowDown"
              ? (current + 1) % choices.length
              : (current - 1 + choices.length) % choices.length;
      event.preventDefault();
      choices[next]?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menuPosition]);

  function openMenu() {
    if (menuPosition) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = Math.min(236, innerWidth - 16);
    const height = Math.min(
      (additionalViews.length + 1) * 46 + 16,
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
    queueMicrotask(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus(),
    );
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
      {items.map(({ key, label, icon: Icon, route }) => (
        <button
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
          <button
            aria-current={active === "views" ? "page" : undefined}
            className={active === "views" ? "is-active" : undefined}
            type="button"
            onClick={() => onNavigate({ page: "views" })}
          >
            <Columns3 aria-hidden="true" size={22} strokeWidth={1.7} />
            <span>Manage views</span>
          </button>
        </div>
      ) : (
        <>
          <button
            aria-controls={menuPosition ? menuId : undefined}
            aria-current={
              active === "views" || hiddenNavigationViewActive
                ? "page"
                : undefined
            }
            aria-expanded={Boolean(menuPosition)}
            aria-haspopup="menu"
            className={
              active === "views" || hiddenNavigationViewActive
                ? "is-active"
                : undefined
            }
            ref={triggerRef}
            type="button"
            onClick={openMenu}
          >
            <Columns3 aria-hidden="true" size={22} strokeWidth={1.7} />
            <span>Views</span>
          </button>
          {menuPosition
            ? createPortal(
                <div
                  aria-label="Views"
                  className="navigation-views-menu"
                  id={menuId}
                  ref={menuRef}
                  role="menu"
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
                </div>,
                document.body,
              )
            : null}
        </>
      )}
      <button
        aria-current={active === "more" ? "page" : undefined}
        className={active === "more" ? "is-active" : undefined}
        type="button"
        onClick={() => onNavigate({ page: "more" })}
      >
        <Settings aria-hidden="true" size={22} strokeWidth={1.7} />
        <span>Settings</span>
      </button>
    </>
  );
}

function navigationViewIcon(view: TaskView): typeof CheckCircle2 {
  if (view.presentation?.type === "tasknotes.planner") return ChartNoAxesGantt;
  if (view.presentation?.type === "tasknotes.kanban") return Columns3;
  if (
    view.presentation?.type === "tasknotes.calendar" ||
    view.presentation?.type === "tasknotes.mini-calendar"
  )
    return CalendarDays;
  return List;
}

function parseRoute(): Route {
  const path = appPathname();
  const task = /^\/task\/([^/]+)$/.exec(path);
  if (task)
    return {
      page: "task",
      id: decodeURIComponent(task[1]),
      occurrence:
        new URLSearchParams(window.location.search).get("occurrence") ??
        undefined,
    };
  const view = /^\/views\/([^/]+)$/.exec(path);
  if (view) return { page: "views", key: decodeURIComponent(view[1]) };
  if (path === "/views") return { page: "views" };
  if (path === "/search") return { page: "search" };
  if (path === "/scratchpad") return { page: "scratchpad" };
  if (path === "/more") return { page: "more" };
  return { page: "home" };
}

function routeUrl(route: Route): string {
  const path =
    route.page === "task"
      ? `/task/${encodeURIComponent(route.id)}`
      : route.page === "views" && route.key
        ? `/views/${encodeURIComponent(route.key)}`
        : route.page === "home"
          ? "/"
          : `/${route.page}`;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const embed = isEmbeddedDemoPath() ? "/embed" : "";
  const url = new URL(location.href);
  url.pathname = `${base}${embed}${path}` || "/";
  url.searchParams.delete("occurrence");
  if (route.page === "task" && route.occurrence) {
    url.searchParams.set("occurrence", route.occurrence);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function appPathname(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length) || "/";
  if (isEmbeddedDemoPath(path)) path = path.slice("/embed".length) || "/";
  if (path.length > 1) path = path.replace(/\/+$/u, "");
  return path;
}

function isEmbeddedDemoPath(pathname = window.location.pathname): boolean {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path =
    base && pathname.startsWith(base)
      ? pathname.slice(base.length) || "/"
      : pathname;
  return path === "/embed" || path.startsWith("/embed/");
}
