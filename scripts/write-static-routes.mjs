import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callbackDirectory = resolve(dist, "auth", "mdbase", "callback");
const staticRouteDirectories = [
  "embed",
  "more",
  "scratchpad",
  "search",
  "views",
].map((route) => resolve(dist, route));

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
  writeFile(resolve(dist, "_redirects"), "/* /index.html 200\n"),
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
