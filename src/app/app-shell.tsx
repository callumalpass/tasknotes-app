import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  CalendarDays,
  CheckCircle2,
  Columns3,
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
import { TaskScreen } from "./task-screen";
import { useNavigationViews } from "./use-navigation-views";
import { ViewsScreen } from "./views-screen";

import type { TaskView } from "../domain/view";

type Route =
  | { page: "home" | "search" | "more" }
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
    recoveryError,
    pendingRecoveryCount,
    undoTaskDeletion,
    retryTaskDeletion,
    retryTaskRecovery,
  } = useRepository();
  const {
    authorizeAnotherCloudCollection,
    canChooseLocalFolder,
    choice,
    changeConnectedCollection,
    changeLocalCollection,
    choose,
    reauthorizeCurrentCloudCollection,
  } = useCollectionGate();
  const {
    documents,
    views,
    error: viewsError,
    navigationViews,
    homeView,
    loading: viewsLoading,
    refresh: refreshViews,
    toggleNavigationView,
    moveNavigationView,
  } = useNavigationViews();
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [captureOpen, setCaptureOpen] = useState(false);
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
    if (choice !== "cloud") return;
    return mdbaseNotifications.listen(({ opened }) => {
      void refresh().catch(() => undefined);
      if (opened) navigate({ page: "home" }, true);
    });
  }, [choice, navigate, refresh]);

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
        {choice === "cloud" ? (
          <button
            className="text-action opening-change-collection"
            type="button"
            onClick={changeConnectedCollection}
          >
            Choose another mdbase collection
          </button>
        ) : null}
      </main>
    );
  }
  if (status === "error") {
    return (
      <StorageErrorScreen
        authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
        canChooseLocalFolder={canChooseLocalFolder}
        changeConnectedCollection={changeConnectedCollection}
        changeLocalCollection={changeLocalCollection}
        choice={choice}
        choose={choose}
        error={error}
        reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
        retry={() => void refresh()}
      />
    );
  }

  const workspace: WorkspaceRoute =
    route.page === "task" ? workspaceRoute : route;
  const workspaceViewKey =
    workspace.page === "home"
      ? homeView?.key
      : workspace.page === "views"
        ? workspace.key
        : undefined;
  const workspaceIsNavigationView = Boolean(
    workspaceViewKey &&
    navigationViews.some((view) => view.key === workspaceViewKey),
  );
  const showGlobalCaptureFab =
    !viewsLoading &&
    (workspace.page === "search" ||
      workspace.page === "home" ||
      Boolean(workspace.page === "views" && workspaceViewKey));
  const activePage =
    workspaceViewKey && workspaceIsNavigationView
      ? `view:${workspaceViewKey}`
      : workspace.page === "views" && !workspace.key
        ? "more"
        : workspace.page === "views"
          ? "views"
          : workspace.page;
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
          homeViewKey={homeView?.key}
          mode="desktop"
          navigationViews={navigationViews}
          onNavigate={navigate}
        />
      </aside>
      <main id="main-content" className="page-surface">
        {workspace.page === "search" ? (
          <SearchScreen
            onBack={() => navigate({ page: "home" }, true)}
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspace.page === "more" ? (
          <MoreScreen onNewTask={() => setCaptureOpen(true)} />
        ) : workspace.page === "home" && viewsLoading ? (
          <HomeViewLoading />
        ) : workspace.page === "views" || workspace.page === "home" ? (
          <ViewsScreen
            documents={documents}
            error={viewsError}
            navigationViewKeys={navigationViews.map((view) => view.key)}
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
            onSearch={() => navigate({ page: "search" })}
            onOpenView={(view) =>
              navigate(
                view.key === homeView?.key
                  ? { page: "home" }
                  : { page: "views", key: view.key },
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
      {route.page !== "task" &&
      !(workspace.page === "home" && viewsLoading) &&
      (workspace.page !== "views" ||
        !workspaceViewKey ||
        workspaceIsNavigationView) ? (
        <nav
          className={`bottom-navigation items-${Math.min(navigationViews.length, 2) + 3}`}
          aria-label="Primary"
        >
          <Navigation
            active={activePage}
            homeViewKey={homeView?.key}
            mode="mobile"
            navigationViews={navigationViews}
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
      {pendingDeletion ? (
        <div
          className={`undo-toast${deletionError ? " deletion-error-toast" : ""}`}
          role={deletionError ? "alert" : "status"}
        >
          <span>
            {deletionError ? "Deletion waiting" : "Deleted"} “
            {pendingDeletion.title}”
          </span>
          {deletionError ? (
            <button
              type="button"
              onClick={() => void retryTaskDeletion().catch(() => undefined)}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void undoTaskDeletion().catch(() => undefined)}
          >
            Undo
          </button>
        </div>
      ) : deletionError ? (
        <div className="undo-toast deletion-error-toast">
          <OperationErrorNotice
            action="The deletion"
            message={deletionError}
            recovery="The task is still in the collection. Try again."
          />
        </div>
      ) : null}
      {recoveryError ? (
        <div className="undo-toast deletion-error-toast" role="alert">
          <span>
            {pendingRecoveryCount} saved task change
            {pendingRecoveryCount === 1 ? " is" : "s are"} waiting
          </span>
          <button
            type="button"
            onClick={() => void retryTaskRecovery().catch(() => undefined)}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function StorageErrorScreen({
  authorizeAnotherCloudCollection,
  canChooseLocalFolder,
  changeConnectedCollection,
  changeLocalCollection,
  choice,
  choose,
  error,
  reauthorizeCurrentCloudCollection,
  retry,
}: {
  authorizeAnotherCloudCollection(): void;
  canChooseLocalFolder: boolean;
  changeConnectedCollection(): void;
  changeLocalCollection(): void;
  choice: "local" | "cloud";
  choose(choice: "local" | "cloud"): void;
  error: Error | null;
  reauthorizeCurrentCloudCollection(): void;
  retry(): void;
}) {
  const authorizationExpired =
    choice === "cloud" && isAuthorizationError(error);
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
          ? "Your connection has expired. Your tasks and offline data remain unchanged."
          : "The collection is unavailable right now."}
      </p>
      <div className="welcome-actions">
        {authorizationExpired ? (
          <>
            <button
              className="outline-action"
              type="button"
              onClick={reauthorizeCurrentCloudCollection}
            >
              Reconnect this collection
            </button>
            <button
              className="text-action"
              type="button"
              onClick={authorizeAnotherCloudCollection}
            >
              Choose another mdbase collection
            </button>
          </>
        ) : (
          <>
            <button className="outline-action" type="button" onClick={retry}>
              Try again
            </button>
            {choice === "cloud" ? (
              <button
                className="text-action"
                type="button"
                onClick={authorizeAnotherCloudCollection}
              >
                Choose another mdbase collection
              </button>
            ) : null}
            {canChooseLocalFolder ? (
              <button
                className="text-action"
                type="button"
                onClick={changeLocalCollection}
              >
                Choose a folder
              </button>
            ) : null}
          </>
        )}
        <button
          className="text-action"
          type="button"
          onClick={() => {
            if (choice === "cloud") changeConnectedCollection();
            choose(choice === "local" ? "cloud" : "local");
          }}
        >
          {choice === "cloud" ? "Use on this device" : "Connect to mdbase"}
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

function Navigation({
  active,
  homeViewKey,
  mode,
  navigationViews,
  onNavigate,
}: {
  active: string;
  homeViewKey?: string;
  mode: "desktop" | "mobile";
  navigationViews: TaskView[];
  onNavigate(route: Route): void;
}) {
  const visibleViews =
    mode === "mobile" ? navigationViews.slice(0, 2) : navigationViews;
  const additionalViews =
    mode === "mobile" ? navigationViews.slice(visibleViews.length) : [];
  const hiddenNavigationViewActive =
    active.startsWith("view:") &&
    !visibleViews.some((view) => active === `view:${view.key}`);
  const items: {
    key: string;
    label: string;
    icon: typeof CheckCircle2;
    route: Route;
  }[] = visibleViews.map((view) => ({
    key: `view:${view.key}`,
    label: view.name,
    icon: navigationViewIcon(view),
    route:
      view.key === homeViewKey
        ? ({ page: "home" } as const)
        : ({ page: "views", key: view.key } as const),
  }));
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
          type="button"
          onClick={() => onNavigate(route)}
        >
          <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
          <span>{label}</span>
        </button>
      ))}
      <button
        aria-current={active === "search" ? "page" : undefined}
        className={active === "search" ? "is-active" : undefined}
        type="button"
        onClick={() => onNavigate({ page: "search" })}
      >
        <Search aria-hidden="true" size={22} strokeWidth={1.7} />
        <span>Search</span>
      </button>
      <button
        aria-controls={menuPosition ? menuId : undefined}
        aria-current={
          active === "views" || hiddenNavigationViewActive ? "page" : undefined
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
                const Icon = navigationViewIcon(view);
                return (
                  <button
                    aria-current={
                      active === `view:${view.key}` ? "page" : undefined
                    }
                    key={view.key}
                    role="menuitem"
                    type="button"
                    onClick={() =>
                      choose(
                        view.key === homeViewKey
                          ? { page: "home" }
                          : { page: "views", key: view.key },
                      )
                    }
                  >
                    <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
                    <span>{view.name}</span>
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
  const url = new URL(location.href);
  url.pathname = `${base}${path}` || "/";
  url.searchParams.delete("occurrence");
  if (route.page === "task" && route.occurrence) {
    url.searchParams.set("occurrence", route.occurrence);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function appPathname(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname;
  if (base && path.startsWith(base)) return path.slice(base.length) || "/";
  return path;
}
