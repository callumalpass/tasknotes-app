/**
 * Claim 1: the contract page budget. Seeds N ordinary tasks, grows one
 * field on every record, and bisects for the size at which `queryContract`
 * refuses the page. Also checks `getContract` and the ordinary query on the
 * same records.
 *
 *   pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts budget
 */
import { test } from "vitest";
import {
  encodedSize,
  openReplica,
  plainTask,
  seed,
  show,
  type Replica,
} from "./harness";

type Filler = "unmapped" | "timeEntries" | "body";

function grow(i: number, bytes: number, filler: Filler) {
  const fm = plainTask(i);
  let body = "";
  if (filler === "unmapped") fm.notes_blob = "x".repeat(bytes);
  if (filler === "timeEntries") {
    // A realistic time-tracking history: ~70 bytes per entry.
    const entries = [];
    let size = 0;
    for (let n = 0; size < bytes; n++) {
      const e = {
        startTime: `2026-01-01T${String(n % 24).padStart(2, "0")}:00:00.000Z`,
        endTime: `2026-01-01T${String(n % 24).padStart(2, "0")}:30:00.000Z`,
      };
      entries.push(e);
      size += 60;
    }
    fm.timeEntries = entries;
  }
  if (filler === "body") body = "y".repeat(bytes);
  return { fm, body };
}

async function setSize(
  r: Replica,
  ids: string[],
  bytes: number,
  filler: Filler,
) {
  const step = Math.max(
    1,
    Math.min(64, Math.floor((1024 * 1024) / Math.max(1, bytes))),
  );
  for (let i = 0; i < ids.length; i += step) {
    const ops = ids.slice(i, i + step).map((id, k) => {
      const { fm, body } = grow(i + k, bytes, filler);
      const patch = new Map<string, unknown>();
      if (filler === "unmapped") patch.set("notes_blob", fm.notes_blob);
      if (filler === "timeEntries") patch.set("timeEntries", fm.timeEntries);
      return r.client.updateOp(
        id,
        filler === "body" ? { body } : { patch: patch as never },
      );
    });
    await r.client.submit(ops);
  }
  return encodedSize(grow(0, bytes, filler).fm);
}

async function contractPage(r: Replica, pageSize: number) {
  try {
    const q = await r.client.queryContract(r.contract, { pageSize });
    return { ok: true as const, records: q.records.length };
  } catch (e) {
    const err = e as { code?: string; reason?: string; message: string };
    return {
      ok: false as const,
      code: err.code,
      reason: err.reason,
      message: err.message,
    };
  }
}

async function threshold(n: number, pageSize: number, filler: Filler) {
  const r = await openReplica();
  const ids = await seed(
    r.client,
    Array.from({ length: n }, (_, i) => ({
      path: `tasks/t${i}.md`,
      frontmatter: plainTask(i),
    })),
  );
  const base = await contractPage(r, pageSize);
  let lo = 0;
  let hi = 1024 * 1024;
  let refusal: unknown;
  if (!base.ok) {
    await r.close();
    return {
      n,
      pageSize,
      filler,
      baseline: base,
      note: "refused with no filler",
    };
  }
  // Find the first refusing size (to 1% or 16 bytes).
  let hiOk = await setSize(r, ids, hi, filler);
  const top = await contractPage(r, pageSize);
  if (top.ok) {
    await r.close();
    return {
      n,
      pageSize,
      filler,
      note: `still ok at ${hiOk} encoded bytes per record`,
    };
  }
  refusal = top;
  while (hi - lo > Math.max(16, lo / 100)) {
    const mid = Math.floor((lo + hi) / 2);
    await setSize(r, ids, mid, filler);
    const res = await contractPage(r, pageSize);
    if (res.ok) lo = mid;
    else {
      hi = mid;
      refusal = res;
    }
  }
  const okEncoded = await setSize(r, ids, lo, filler);
  // Same records, at the largest passing size + 1 step: ordinary query and getContract.
  hiOk = await setSize(r, ids, hi, filler);
  let ordinary: string;
  try {
    let count = 0;
    for await (const page of r.client.pages(
      { types: ["task"], limit: 1000 },
      { effective: true },
    ))
      count += page.records.length;
    ordinary = `ok (${count} records)`;
  } catch (e) {
    ordinary = `refused: ${(e as Error).message}`;
  }
  let single: string;
  try {
    await r.client.getContract(ids[0]!, r.contract);
    single = "ok";
  } catch (e) {
    single = `refused: ${(e as { code?: string }).code} ${(e as Error).message}`;
  }
  await r.close();
  return {
    n,
    pageSize,
    filler,
    lastOkFiller: lo,
    firstRefusedFiller: hi,
    lastOkEncodedFrontmatter: okEncoded,
    firstRefusedEncodedFrontmatter: hiOk,
    refusal,
    ordinaryQueryAtRefusedSize: ordinary,
    getContractAtRefusedSize: single,
  };
}

async function largestPage(n: number) {
  const r = await openReplica();
  await seed(
    r.client,
    Array.from({ length: n }, (_, i) => ({
      path: `tasks/t${i}.md`,
      frontmatter: plainTask(i),
    })),
  );
  let lo = 0;
  let hi = 129;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await contractPage(r, mid)).ok) lo = mid;
    else hi = mid;
  }
  let pages = 0;
  let records = 0;
  let cursor: string | undefined;
  do {
    const q = await r.client.queryContract(r.contract, {
      pageSize: lo,
      cursor,
    });
    pages++;
    records += q.records.length;
    cursor = q.page.cursor;
  } while (cursor);
  await r.close();
  return {
    plainTaskEncodedBytes: encodedSize(plainTask(1)),
    largestPassingPageSize: lo,
    fullReadAtThatSize: { pages, records },
  };
}

test("contract page budget thresholds", async () => {
  console.log("plain tasks:", show(await largestPage(300)));
  const cases: Array<[number, number, Filler]> = [
    [1, 1, "unmapped"],
    [1, 1, "timeEntries"],
    [1, 1, "body"],
    [8, 8, "unmapped"],
    [32, 32, "unmapped"],
    [32, 32, "body"],
  ];
  for (const [n, size, filler] of cases)
    console.log(show(await threshold(n, size, filler)));
});
