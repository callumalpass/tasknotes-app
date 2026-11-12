import { stat } from "node:fs/promises";

/** Vitest workers resolve the repository package.json while suites load. A
 * test that rewrites it, even to identical bytes, can leave a worker reading a
 * truncated file (#412), so the unit run must never write these files. */
const guarded = ["../package.json", "../pnpm-lock.yaml"].map(
  (path) => new URL(path, import.meta.url),
);

async function fingerprint(url) {
  const { ino, size, mtimeMs } = await stat(url);
  return { ino, size, mtimeMs };
}

export default async function setup() {
  const before = await Promise.all(guarded.map(fingerprint));
  return async function teardown() {
    const after = await Promise.all(guarded.map(fingerprint));
    const changed = guarded.filter(
      (_, index) =>
        JSON.stringify(after[index]) !== JSON.stringify(before[index]),
    );
    if (!changed.length) return;
    console.error(
      `The unit tests rewrote ${changed.map((url) => url.pathname).join(", ")}. ` +
        "Tests must use a scratch directory, not the repository's own files.",
    );
    // Vitest only logs a teardown error, so fail the run explicitly.
    process.exitCode = 1;
  };
}
