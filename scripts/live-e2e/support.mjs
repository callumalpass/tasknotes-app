import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";

export const evidenceRoot = resolve(
  process.env.E2E_EVIDENCE_ROOT ??
    "/home/calluma/worktrees/mdbase-next/.coord/scratch/e2e",
);
export const expected = {
  source: "850460ac7a00d083132a8fd3f8fbe7262c3abc4f",
  runtime_source: "d70c9487db12fc864fd68ea8b8d26586d12276fa",
  runtime_sha256:
    "58e9ed23146a956af24b936359fc79c931873eda1c8d9e297f5196f02ddaa265",
  url: "http://127.0.0.1:48218/",
  cp_source: "70fa373df6c8fa55f0463f16d67b75a6f94686a2",
  sdk_source: "5369226d26baa338b98e25feed9c0454e52f5865",
};

export function assertSingleBrowserPolicy(count) {
  if (count !== 1)
    throw Error(
      "Live LAB policy permits one browser at a time; concurrent workflow disabled",
    );
}

export function portableScratchpadId(attributes) {
  if (
    !Array.isArray(attributes) ||
    attributes.length === 0 ||
    attributes.some(
      (value) => typeof value !== "string" || !value.includes(":"),
    )
  )
    throw Error("Rendered portable note identity unavailable");
  const ids = [...new Set(attributes.map((value) => value.split(":", 1)[0]))];
  if (
    ids.length !== 1 ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ids[0])
  )
    throw Error("Rendered portable note identity unavailable");
  return ids[0];
}

export function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
      try {
        return `${new URL(raw).origin}/[redacted-path]`;
      } catch {
        return "[url]";
      }
    })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[id]",
    )
    .replace(/\b\d{6}\b/g, "[code]")
    .replace(/\b[A-Z0-9_-]{24,}\b/gi, "[opaque]")
    .slice(0, 8000);
}

export function assertReadiness(record) {
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) throw Error(`READY mismatch: ${key}`);
  }
  if (
    record.mode !== "lab" ||
    !record.source_clean ||
    !record.runtime_dist_vendor_qualified_http_equal ||
    !record.index_sha256 ||
    !record.entry_resources?.length
  )
    throw Error("Incomplete release READY");
}

export function ownedPath(path) {
  const absolute = resolve(path);
  const inside = relative(evidenceRoot, absolute);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw Error("Not an owned evidence path");
  return absolute;
}

export async function verifyServed(readyPath) {
  const record = JSON.parse(await readFile(readyPath, "utf8"));
  assertReadiness(record);
  const buildExit = await readFile(
    resolve(dirname(readyPath), "merged-app-build.exit"),
    "utf8",
  );
  if (buildExit.trim() !== "0") throw Error("Release LAB build did not pass");
  const resources = [
    { path: "/", sha256: record.index_sha256 },
    ...record.entry_resources,
    { path: record.runtime_path, sha256: record.runtime_sha256 },
  ];
  for (const resource of resources) {
    const url = new URL(resource.path, record.url);
    if (url.origin !== new URL(expected.url).origin || url.search || url.hash)
      throw Error("Invalid READY resource path");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Served resource HTTP ${response.status}`);
    const hash = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    if (hash !== resource.sha256) throw Error("Served resource hash mismatch");
  }
  return record;
}

export async function saveReport(path, data) {
  const destination = ownedPath(path);
  await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
}

// Before a mutating UI click, retain a one-shot action marker. Unknown outcomes
// are inspected, never automatically resubmitted by this harness.
export async function once(runRoot, action, operation) {
  if (!/^[a-z0-9-]+$/.test(action)) throw Error("Invalid action label");
  const marker = ownedPath(resolve(runRoot, `${action}.once.json`));
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await writeFile(
    marker,
    JSON.stringify({ action, started: new Date().toISOString() }),
    { flag: "wx", mode: 0o600 },
  );
  return operation();
}
