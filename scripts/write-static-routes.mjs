import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callbackDirectory = resolve(dist, "auth", "mdbase", "callback");
const embedDirectory = resolve(dist, "embed");

await Promise.all([
  mkdir(callbackDirectory, { recursive: true }),
  mkdir(embedDirectory, { recursive: true }),
]);
await Promise.all([
  copyFile(index, resolve(dist, "404.html")),
  copyFile(index, resolve(dist, "auth", "mdbase", "callback.html")),
  copyFile(index, resolve(callbackDirectory, "index.html")),
  copyFile(index, resolve(embedDirectory, "index.html")),
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
