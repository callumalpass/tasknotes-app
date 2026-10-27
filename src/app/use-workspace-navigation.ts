import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { nativeBackAction } from "../native/navigation";
import { isSettingsSection, type SettingsSection } from "./settings-sections";
import {
  navigationMotion,
  transitionNavigation,
} from "./navigation-transition";

export type Route =
  | { page: "home" | "search" | "scratchpad" }
  | { page: "more"; section?: SettingsSection }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };
export type WorkspaceRoute = Exclude<Route, { page: "task" }>;

// Screens that cannot be left yet (an unsaveable or refused draft) veto
// browser history navigation the same way their own Back button does.
const leaveGuards = new Set<() => boolean>();

/** While `blocked`, browser Back/Forward stays on this screen and calls `onBlocked`. */
export function useHistoryLeaveGuard(blocked: boolean, onBlocked: () => void) {
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  }, [onBlocked]);
  useEffect(() => {
    if (!blocked) return;
    const guard = () => {
      onBlockedRef.current();
      return true;
    };
    leaveGuards.add(guard);
    return () => {
      leaveGuards.delete(guard);
    };
  }, [blocked]);
}

// Navigation owns the mounted workspace, history, and detail return target.
// Capture and notices intentionally remain with the shell.
export function useWorkspaceNavigation(
  navigationViews: readonly { key: string }[],
) {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [workspaceRoute, setWorkspaceRoute] = useState<WorkspaceRoute>(() => {
    const initial = parseRoute();
    return initial.page === "task" ? { page: "home" } : initial;
  });
  const taskReturn = useRef<{
    element: HTMLElement | null;
    scrollY: number;
    workspaceUrl: string;
  } | null>(null);
  const currentRouteUrl = routeUrl(route);
  const routeRef = useRef(route);
  const detailRef = useRef<HTMLElement>(null);
  const previousPage = useRef(route.page);
  // Restore before paint so a route's view transition captures the result.
  useLayoutEffect(() => {
    const wasTask = previousPage.current === "task";
    previousPage.current = route.page;
    if (route.page === "task" && !wasTask)
      detailRef.current?.focus({ preventScroll: true });
    else if (wasTask && route.page !== "task" && taskReturn.current) {
      const target = taskReturn.current;
      taskReturn.current = null;
      if (target.workspaceUrl !== currentRouteUrl) return;
      window.scrollTo({ top: target.scrollY, left: 0 });
      if (target.element?.isConnected)
        target.element.focus({ preventScroll: true });
      else
        document.getElementById("main-content")?.focus({ preventScroll: true });
    }
  }, [route.page, currentRouteUrl]);

  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if ([...leaveGuards].some((blocked) => blocked())) {
        const current = routeRef.current;
        window.history.pushState(
          current.page === "task" ? { taskPanel: true } : null,
          "",
          routeUrl(current),
        );
        return;
      }
      const next = parseRoute();
      const apply = () => {
        setRoute(next);
        if (next.page !== "task") setWorkspaceRoute(next);
      };
      // A browser swipe-back has already animated the change.
      if (event.hasUAVisualTransition) apply();
      else
        transitionNavigation(navigationMotion(routeRef.current, next), apply, {
          traversal: true,
        });
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const navigate = useCallback(
    (next: Route, replace = false) => {
      const url = routeUrl(next);
      // Choosing another task swaps the open panel's entry, so Back closes the
      // panel instead of revisiting earlier selections. `taskPanel` marks an
      // entry pushed over the workspace and survives the swap.
      if (next.page === "task" && route.page === "task") replace = true;
      const state =
        next.page !== "task"
          ? null
          : {
              taskPanel: replace
                ? Boolean(window.history.state?.taskPanel)
                : true,
            };
      if (replace) window.history.replaceState(state, "", url);
      else window.history.pushState(state, "", url);
      if (next.page === "task" && route.page !== "task")
        taskReturn.current = {
          element:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          scrollY: window.scrollY,
          workspaceUrl: routeUrl(route),
        };
      transitionNavigation(navigationMotion(route, next), () => {
        if (next.page !== "task") setWorkspaceRoute(next);
        else if (route.page !== "task") setWorkspaceRoute(route);
        setRoute(next);
        if (next.page !== "task") window.scrollTo({ top: 0, left: 0 });
      });
    },
    [route],
  );
  const navigateRef = useRef(navigate);
  const navigationViewKeysRef = useRef(navigationViews.map((view) => view.key));
  useEffect(() => {
    routeRef.current = route;
    navigateRef.current = navigate;
    navigationViewKeysRef.current = navigationViews.map((view) => view.key);
  }, [navigate, navigationViews, route]);

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

  return { route, workspaceRoute, navigate, detailRef };
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
  const settings = /^\/more\/([^/]+)$/.exec(path);
  if (settings) {
    const section = decodeURIComponent(settings[1]);
    return isSettingsSection(section)
      ? { page: "more", section }
      : { page: "more" };
  }
  return { page: "home" };
}

function routeUrl(route: Route): string {
  const path =
    route.page === "task"
      ? `/task/${encodeURIComponent(route.id)}`
      : route.page === "views" && route.key
        ? `/views/${encodeURIComponent(route.key)}`
        : route.page === "more" && route.section
          ? `/more/${route.section}`
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
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length) || "/";

  if (path.length > 1) path = path.replace(/\/+$/u, "");
  return path;
}
