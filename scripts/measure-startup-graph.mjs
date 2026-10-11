import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Uncompressed emitted bytes, not transfer, timing, CPU or native readiness. */
export async function measureStartupGraph(
  directory,
  { requireOptionalSplit = false } = {},
) {
  const root = resolve(directory);
  const manifestBytes = await readFile(resolve(root, ".vite/manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  if (!manifest["index.html"]?.isEntry)
    throw new Error("Missing app manifest entry");
  const eager = new Set();
  function visit(key) {
    if (eager.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing static manifest dependency: ${key}`);
    eager.add(key);
    for (const child of chunk.imports ?? []) visit(child);
  }
  visit("index.html");
  const files = [
    ...new Set(
      [...eager]
        .map((key) => manifest[key].file)
        .filter((file) => file.endsWith(".js")),
    ),
  ].sort();
  const artifacts = await Promise.all(
    files.map(async (file) => {
      const path = resolve(root, file);
      if (!path.startsWith(root + sep))
        throw new Error("Asset leaves build root");
      const bytes = await readFile(path);
      return {
        file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const htmlFiles = [
    ...new Set(
      [
        ...html.matchAll(
          /<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.js)"[^>]*>/g,
        ),
      ].map((match) => match[1].replace(/^\//, "")),
    ),
  ].sort();
  const htmlBytes = (
    await Promise.all(
      htmlFiles.map(async (file) => {
        const path = resolve(root, file);
        if (!path.startsWith(root + sep))
          throw new Error("HTML asset leaves build root");
        return (await stat(path)).size;
      }),
    )
  ).reduce((sum, bytes) => sum + bytes, 0);
  const optionalSources = [
    "src/app/app-shell-content.tsx",
    "src/app/views/calendar-view-presentation.tsx",
    "src/app/full-calendar-view.tsx",
    "src/components/markdown-source-editor.tsx",
    "src/app/views/view-catalog.tsx",
  ];
  const optionalFeatures = optionalSources.map((source) => {
    const chunk = manifest[source];
    return {
      source,
      file: chunk?.file ?? null,
      deferred: !!chunk?.isDynamicEntry && !files.includes(chunk.file),
    };
  });
  if (
    requireOptionalSplit &&
    optionalFeatures.some((feature) => !feature.deferred)
  )
    throw new Error(
      "Optional calendar/editor/catalog UI re-entered the eager startup graph",
    );
  return {
    qualification:
      "static app-entry closure only; dynamic imports and separate Worker/service-worker entries excluded; no browser timings",
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    eagerJsFiles: artifacts.length,
    eagerJsBytes: artifacts.reduce((sum, item) => sum + item.bytes, 0),
    htmlListedJsFiles: htmlFiles.length,
    htmlListedJsBytes: htmlBytes,
    optionalFeatures,
    artifacts,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await measureStartupGraph(process.argv[2] ?? "dist", {
        requireOptionalSplit: process.argv.includes("--assert-split"),
      }),
      null,
      2,
    ),
  );
}
