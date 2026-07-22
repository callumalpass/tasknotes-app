import {
  CalendarDays,
  CheckCircle2,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";

import { LoadingRows } from "../components/loading";
import { tasknotesMarkUrl } from "./assets";
import { useRepository } from "./repository-context";
import { MoreScreen } from "./more-screen";
import { SearchScreen } from "./search-screen";
import { TaskScreen } from "./task-screen";
import { TodayScreen } from "./today-screen";
import { UpcomingScreen } from "./upcoming-screen";
import { ViewsScreen } from "./views-screen";

type Route =
  | { page: "today" | "upcoming" | "search" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };

export function AppShell() {
  const { status, error } = useRepository();
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const pop = () => setRoute(parseRoute());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  function navigate(next: Route, replace = false) {
    const url = routeUrl(next);
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setRoute(next);
  }

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
          onNavigate={(page) => navigate({ page })}
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
        ) : route.page === "more" ? (
          <MoreScreen onOpenViews={() => navigate({ page: "views" })} />
        ) : route.page === "views" ? (
          <ViewsScreen
            viewKey={route.key}
            onBack={() =>
              navigate(route.key ? { page: "views" } : { page: "more" }, true)
            }
            onOpenTask={(task, occurrence) =>
              navigate({ page: "task", id: task.id, occurrence })
            }
            onOpenView={(view) => navigate({ page: "views", key: view.key })}
          />
        ) : "id" in route ? (
          <TaskScreen
            id={route.id}
            occurrenceDate={route.occurrence}
            onBack={() => window.history.back()}
          />
        ) : null}
      </main>
      {route.page !== "task" && route.page !== "views" ? (
        <nav className="bottom-navigation" aria-label="Primary">
          <Navigation
            active={activePage}
            onNavigate={(page) => navigate({ page })}
          />
        </nav>
      ) : null}
    </div>
  );
}

function Navigation({
  active,
  onNavigate,
}: {
  active: "today" | "upcoming" | "search" | "more";
  onNavigate(page: "today" | "upcoming" | "search" | "more"): void;
}) {
  const items = [
    { page: "today" as const, label: "Today", icon: CheckCircle2 },
    { page: "upcoming" as const, label: "Upcoming", icon: CalendarDays },
    { page: "search" as const, label: "Search", icon: Search },
    { page: "more" as const, label: "More", icon: MoreHorizontal },
  ];
  return items.map(({ page, label, icon: Icon }) => (
    <button
      aria-current={active === page ? "page" : undefined}
      className={active === page ? "is-active" : undefined}
      key={page}
      type="button"
      onClick={() => onNavigate(page)}
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
