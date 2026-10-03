import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { nativeBackAction } from "../native/navigation";

export type Route =
  | { page: "home" | "search" | "scratchpad" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string; occurrence?: string };
export type WorkspaceRoute = Exclude<Route, { page: "task" }>;

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
  const detailRef = useRef<HTMLElement>(null);
  const previousPage = useRef(route.page);
  useEffect(() => {
    const wasTask = previousPage.current === "task";
    previousPage.current = route.page;
    const frame = requestAnimationFrame(() => {
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
          document
            .getElementById("main-content")
            ?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [route.page, currentRouteUrl]);

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
        if (route.page !== "task") {
          taskReturn.current = {
            element:
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null,
            scrollY: window.scrollY,
            workspaceUrl: routeUrl(route),
          };
          setWorkspaceRoute(route);
        }
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
