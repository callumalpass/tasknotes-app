import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
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
await Promise.all([
  copyFile(index, resolve(dist, "404.html")),
  copyFile(index, resolve(dist, "auth", "mdbase", "callback.html")),
  copyFile(index, resolve(callbackDirectory, "index.html")),
  ...staticRouteDirectories.map((directory) =>
    copyFile(index, resolve(directory, "index.html")),
  ),
]);

const offlineAssets = (await listFiles(dist))
  .filter(
    (path) =>
      path === "index.html" ||
      path === "manifest.webmanifest" ||
      path === "tasknotes-mark.svg" ||
      /^icon(?:-\d+)?\.png$/.test(path) ||
      path.startsWith("assets/"),
  )
  .map((path) => `./${path}`);
await writeFile(
  resolve(dist, "offline-assets.json"),
  `${JSON.stringify(["./", ...offlineAssets], null, 2)}\n`,
);

await writeFile(resolve(dist, "_redirects"), await pagesRedirects(dist));

/** Cloudflare Pages applies _redirects before static files and ignores
 * `/* /index.html 200` as a loop, so a deep route would reach 404.html with a
 * 404 status. Real files and asset directories pass through first (a missing
 * asset still gets a real 404); every other path is rewritten to the app shell. */
async function pagesRedirects(root) {
  const skip = new Set([
    "_headers",
    "_redirects",
    "_routes.json",
    "index.html",
    "404.html",
  ]);
  const rules = [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (/\s/.test(entry.name))
      throw new Error(`Unroutable file name in dist: ${entry.name}`);
    if (entry.isDirectory()) {
      if (!(await appShellCopiesOnly(resolve(root, entry.name))))
        rules.push(`/${entry.name}/* /${entry.name}/:splat 200`);
    } else if (!skip.has(entry.name)) {
      rules.push(`/${entry.name} /${entry.name} 200`);
    }
  }
  rules.push("/* / 200");
  return `${rules.join("\n")}\n`;
}

/** Route directories hold only copies of the app shell (static routes and the
 * sign-in callback); the app-shell rewrite already serves them. */
async function appShellCopiesOnly(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const ok = entry.isDirectory()
      ? await appShellCopiesOnly(resolve(directory, entry.name))
      : entry.name === "index.html" || entry.name === "callback.html";
    if (!ok) return false;
  }
  return true;
}

async function listFiles(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? listFiles(resolve(directory, entry.name), path)
        : [path];
    }),
  );
  return files.flat().sort();
}
