import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const forbidden = [
  "Review demo task",
  "demo-planning-session",
  "DemoTaskRepository",
  "__TASKNOTES_NEXT_SMOKE__",
  "Loading demo test fixture",
];

/** Check emitted production/LAB code, not source-level import assumptions. */
export async function assertNoProductionFixtures(directory) {
  await readFile(join(directory, "index.html"), "utf8");
  let scripts = 0;
  async function inspect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        await inspect(path);
      } else if (/\.(?:js|mjs|html|css|json)$/.test(entry.name)) {
        if (/\.(?:js|mjs)$/.test(entry.name)) scripts++;
        const source = await readFile(path, "utf8");
        const marker = forbidden.find((value) => source.includes(value));
        if (marker || /\.searchParams\.get\(["']demo["']\)/.test(source))
          throw new Error(
            `Test-only fixture emitted in ${path}: ${marker ?? "demo route"}`,
          );
      }
    }
  }
  await inspect(directory);
  if (!scripts) throw new Error("No emitted application scripts to inspect.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await assertNoProductionFixtures(resolve(process.argv[2] ?? "dist"));
  console.log("Production bundle excludes demo and held-client test fixtures.");
}
