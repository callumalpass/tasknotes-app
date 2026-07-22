import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  CalendarDays,
  CheckCircle2,
  Columns3,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LoadingRows } from "../components/loading";
import { nativeBackAction } from "../native/navigation";
import { listenForTaskNotificationActions } from "../native/notifications";
import { tasknotesMarkUrl } from "./assets";
import { useRepository } from "./repository-context";
import { MoreScreen } from "./more-screen";
import { ArchiveScreen } from "./archive-screen";
import { SearchScreen } from "./search-screen";
import { TaskScreen } from "./task-screen";
import { TodayScreen } from "./today-screen";
import { UpcomingScreen } from "./upcoming-screen";
import { usePrimaryView } from "./use-primary-view";
import { ViewsScreen } from "./views-screen";

import type { TaskView } from "../domain/view";

type Route =
  | { page: "today" | "upcoming" | "search" | "archive" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };

export function AppShell() {
  const { status, error } = useRepository();
  const {
    views,
    error: viewsError,
    primaryView,
    refresh: refreshViews,
    setPrimaryView,
  } = usePrimaryView();
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const pop = () => setRoute(parseRoute());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const url = routeUrl(next);
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setRoute(next);
    window.scrollTo({ top: 0, left: 0 });
  }, []);

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
      const action = nativeBackAction(route, primaryView?.key);
      if (action === "back") window.history.back();
      else if (action === "home") navigate({ page: "today" }, true);
      else void CapacitorApp.exitApp();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else remove = () => handle.remove();
    });
    return () => {
      disposed = true;
      void remove?.();
    };
  }, [navigate, primaryView?.key, route]);

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
    return (
      <main className="opening-screen storage-error">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>TaskNotes could not open.</h1>
        <p>{error?.message ?? "Local storage is unavailable."}</p>
      </main>
    );
  }

  const activePage =
    route.page === "task"
      ? "today"
      : route.page === "views" && route.key === primaryView?.key
        ? `view:${route.key}`
        : route.page === "views"
          ? "more"
          : route.page;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="navigation-rail" aria-label="Primary">
        <button
          className="wordmark"
          type="button"
          onClick={() => navigate({ page: "today" })}
        >
          <img alt="" src={tasknotesMarkUrl} />
          <span>TaskNotes</span>
        </button>
        <Navigation
          active={activePage}
          primaryView={primaryView}
          onNavigate={navigate}
        />
      </aside>
      <main id="main-content" className="page-surface">
        {route.page === "today" ? (
          <TodayScreen
            onOpen={(task, occurrence) =>
              navigate({ page: "task", id: task.id, occurrence })
            }
          />
        ) : route.page === "upcoming" ? (
          <UpcomingScreen
            onOpen={(task, occurrence) =>
              navigate({ page: "task", id: task.id, occurrence })
            }
          />
        ) : route.page === "search" ? (
          <SearchScreen
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : route.page === "archive" ? (
          <ArchiveScreen
            onBack={() => navigate({ page: "more" }, true)}
            onOpen={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : route.page === "more" ? (
          <MoreScreen
            primaryViewName={primaryView?.name}
            onOpenArchive={() => navigate({ page: "archive" })}
            onOpenViews={() => {
              void refreshViews();
              navigate({ page: "views" });
            }}
          />
        ) : route.page === "views" ? (
          <ViewsScreen
            error={viewsError}
            operational={route.key === primaryView?.key}
            primaryViewKey={primaryView?.key}
            views={views}
            viewKey={route.key}
            onBack={() =>
              navigate(route.key ? { page: "views" } : { page: "more" }, true)
            }
            onOpenTask={(task, occurrence) =>
              navigate({ page: "task", id: task.id, occurrence })
            }
            onOpenView={(view) => navigate({ page: "views", key: view.key })}
            onSetPrimaryView={setPrimaryView}
          />
        ) : "id" in route ? (
          <TaskScreen
            id={route.id}
            occurrenceDate={route.occurrence}
            onBack={() => window.history.back()}
            onMaterialized={(task) =>
              navigate({ page: "task", id: task.id }, true)
            }
          />
        ) : null}
      </main>
      {route.page !== "task" &&
      (route.page !== "views" || route.key === primaryView?.key) ? (
        <nav
          className={`bottom-navigation${primaryView ? " has-primary" : ""}`}
          aria-label="Primary"
        >
          <Navigation
            active={activePage}
            primaryView={primaryView}
            onNavigate={navigate}
          />
        </nav>
      ) : null}
    </div>
  );
}

function Navigation({
  active,
  primaryView,
  onNavigate,
}: {
  active: string;
  primaryView?: TaskView;
  onNavigate(route: Route): void;
}) {
  const items: {
    key: string;
    label: string;
    icon: typeof CheckCircle2;
    route: Route;
  }[] = [
    {
      key: "today",
      label: "Today",
      icon: CheckCircle2,
      route: { page: "today" },
    },
    {
      key: "upcoming",
      label: "Upcoming",
      icon: CalendarDays,
      route: { page: "upcoming" },
    },
    ...(primaryView
      ? [
          {
            key: `view:${primaryView.key}`,
            label: primaryView.name,
            icon: Columns3,
            route: { page: "views" as const, key: primaryView.key },
          },
        ]
      : []),
    { key: "search", label: "Search", icon: Search, route: { page: "search" } },
    {
      key: "more",
      label: "More",
      icon: MoreHorizontal,
      route: { page: "more" },
    },
  ];
  return items.map(({ key, label, icon: Icon, route }) => (
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
  ));
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
  if (path === "/upcoming") return { page: "upcoming" };
  if (path === "/more") return { page: "more" };
  return { page: "today" };
}

function routeUrl(route: Route): string {
  const path =
    route.page === "task"
      ? `/task/${encodeURIComponent(route.id)}${route.occurrence ? `?occurrence=${encodeURIComponent(route.occurrence)}` : ""}`
      : route.page === "views" && route.key
        ? `/views/${encodeURIComponent(route.key)}`
        : route.page === "today"
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
