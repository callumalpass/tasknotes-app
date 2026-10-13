import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callbackDirectory = resolve(dist, "auth", "mdbase", "callback");
const staticRouteDirectories = ["more", "scratchpad", "search", "views"].map(
  (route) => resolve(dist, route),
);

await Promise.all([
  mkdir(callbackDirectory, { recursive: true }),
  ...staticRouteDirectories.map((directory) =>
    mkdir(directory, { recursive: true }),
  ),
]);
// Cloudflare Pages (root base) serves public/404.html for unknown paths and
// rewrites only the app's own routes (_redirects below). GitHub Pages staging
// (non-root base) has no rewrites, so there 404.html stays the app shell.
const rootBase = (process.env.VITE_BASE_PATH ?? "/") === "/";
await Promise.all([
  ...(rootBase ? [] : [copyFile(index, resolve(dist, "404.html"))]),
  copyFile(index, resolve(dist, "auth", "mdbase", "callback.html")),
  copyFile(index, resolve(callbackDirectory, "index.html")),
  ...staticRouteDirectories.map((directory) =>
    copyFile(index, resolve(directory, "index.html")),
  ),
]);

await writeFile(resolve(dist, "_redirects"), pagesRedirects());

/** The app's client routes (see use-workspace-navigation.ts), served by the
 * app shell. Pages applies _redirects before static files, and a rewrite to
 * `/index.html` would loop, so each points at `/`. Files are served as they
 * are; any other path gets 404.html with a 404 status. */
function pagesRedirects() {
  const routes = [
    "/auth/mdbase/callback",
    "/auth/mdbase/callback/",
    "/more",
    "/more/*",
    "/scratchpad",
    "/scratchpad/",
    "/search",
    "/search/",
    "/task/*",
    "/views",
    "/views/*",
  ];
  return routes.map((route) => `${route} / 200\n`).join("");
}
