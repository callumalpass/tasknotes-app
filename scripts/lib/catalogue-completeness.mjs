import assert from "node:assert/strict";

/** Authored PO only: compiler fallback must never supply catalogue completeness. */
export function assertCompleteCatalogue(entries, locale) {
  const active = Object.entries(entries).filter(([, entry]) => !entry.obsolete);
  const missing = active
    .filter(([, entry]) => !entry.translation?.trim())
    .map(([id]) => id);
  assert.equal(
    missing.length,
    0,
    `${locale} translations missing before fallback: ${missing.join(", ")}`,
  );
  return active.length;
}
