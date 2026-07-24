import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  CalendarDays,
  CheckCircle2,
  Columns3,
  List,
  MoreHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LoadingRows } from "../components/loading";
import { nativeBackAction } from "../native/navigation";
import { listenForTaskNotificationActions } from "../native/notifications";
import { tasknotesMarkUrl } from "./assets";
import { isAuthorizationError, technicalErrorMessage } from "./auth-error";
import { useCollectionGate } from "./collection-context";
import { useRepository } from "./repository-context";
import { MoreScreen } from "./more-screen";
import { ArchiveScreen } from "./archive-screen";
import { SearchScreen } from "./search-screen";
import { TaskScreen } from "./task-screen";
import { useNavigationViews } from "./use-navigation-views";
import { ViewsScreen } from "./views-screen";

import type { TaskView } from "../domain/view";

type Route =
  | { page: "home" | "search" | "archive" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };
type WorkspaceRoute = Exclude<Route, { page: "task" }>;

export function AppShell() {
  const { status, error } = useRepository();
  const { choice, changeConnectedCollection, choose } = useCollectionGate();
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
  const [workspaceRoute, setWorkspaceRoute] = useState<WorkspaceRoute>(() => {
    const initial = parseRoute();
    return initial.page === "task" ? { page: "home" } : initial;
  });

  useEffect(() => {
    const pop = () => {
      const next = parseRoute();
      setRoute(next);
      if (next.page !== "task") setWorkspaceRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
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

  useEffect(
    () =>
      listenForTaskNotificationActions((id) => navigate({ page: "task", id })),
    [navigate],
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("backButton", () => {
      const action = nativeBackAction(
        route,
        navigationViews.map((view) => view.key),
      );
      if (action === "back") window.history.back();
      else if (action === "home") navigate({ page: "home" }, true);
      else void CapacitorApp.exitApp();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else remove = () => handle.remove();
    });
    return () => {
      disposed = true;
      void remove?.();
    };
  }, [navigate, navigationViews, route]);

  if (status === "opening") {
    return (
      <main className="opening-screen">
        <img alt="" src={tasknotesMarkUrl} />
        <p>Opening your tasks</p>
        <LoadingRows count={4} />
      </main>
    );
  }
  if (status === "error") {
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
            <button
              className="outline-action"
              type="button"
              onClick={changeConnectedCollection}
            >
              Reconnect to mdbase
            </button>
          ) : (
            <button
              className="outline-action"
              type="button"
              onClick={() => location.reload()}
            >
              Try again
            </button>
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
  const activePage =
    workspaceViewKey && workspaceIsNavigationView
      ? `view:${workspaceViewKey}`
      : workspace.page === "views" || workspace.page === "search"
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
            onBack={() => navigate({ page: "views" }, true)}
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspace.page === "archive" ? (
          <ArchiveScreen
            onBack={() => navigate({ page: "more" }, true)}
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspace.page === "more" ? (
          <MoreScreen
            navigationViewCount={navigationViews.length}
            onOpenArchive={() => navigate({ page: "archive" })}
            onOpenViews={() => {
              void refreshViews();
              navigate({ page: "views" });
            }}
          />
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
          className={`bottom-navigation items-${Math.min(navigationViews.length, 3) + 2}`}
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
    </div>
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
    mode === "mobile" ? navigationViews.slice(0, 3) : navigationViews;
  const hiddenNavigationViewActive =
    mode === "mobile" &&
    active.startsWith("view:") &&
    !visibleViews.some((view) => active === `view:${view.key}`);
  const items: {
    key: string;
    label: string;
    icon: typeof CheckCircle2;
    route: Route;
  }[] = [
    ...visibleViews.map((view) => ({
      key: `view:${view.key}`,
      label: view.name,
      icon: navigationViewIcon(view),
      route:
        view.key === homeViewKey
          ? ({ page: "home" } as const)
          : ({ page: "views", key: view.key } as const),
    })),
    {
      key: "views",
      label:
        mode === "mobile" && navigationViews.length > visibleViews.length
          ? "More views"
          : "Views",
      icon: Columns3,
      route: { page: "views" },
    },
    {
      key: "more",
      label: "More",
      icon: MoreHorizontal,
      route: { page: "more" },
    },
  ];
  return items.map(({ key, label, icon: Icon, route }) => (
    <button
      aria-current={
        active === key || (key === "views" && hiddenNavigationViewActive)
          ? "page"
          : undefined
      }
      className={
        active === key || (key === "views" && hiddenNavigationViewActive)
          ? "is-active"
          : undefined
      }
      key={key}
      type="button"
      onClick={() => onNavigate(route)}
    >
      <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
      <span>{label}</span>
    </button>
  ));
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
  if (path === "/archive") return { page: "archive" };
  if (path === "/more") return { page: "more" };
  return { page: "home" };
}

function routeUrl(route: Route): string {
  const path =
    route.page === "task"
      ? `/task/${encodeURIComponent(route.id)}${route.occurrence ? `?occurrence=${encodeURIComponent(route.occurrence)}` : ""}`
      : route.page === "views" && route.key
        ? `/views/${encodeURIComponent(route.key)}`
        : route.page === "home"
          ? "/"
          : `/${route.page}`;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${path}` || "/";
}

function appPathname(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname;
  if (base && path.startsWith(base)) return path.slice(base.length) || "/";
  return path;
}
