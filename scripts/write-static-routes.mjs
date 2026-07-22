import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const index = resolve(dist, "index.html");
const callbackDirectory = resolve(dist, "auth", "mdbase", "callback");

await mkdir(callbackDirectory, { recursive: true });
await Promise.all([
  copyFile(index, resolve(dist, "404.html")),
  copyFile(index, resolve(dist, "auth", "mdbase", "callback.html")),
  copyFile(index, resolve(callbackDirectory, "index.html")),
]);
