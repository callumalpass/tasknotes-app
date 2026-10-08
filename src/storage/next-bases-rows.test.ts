import { describe, expect, it, vi } from "vitest";
import type { wire } from "@mdbase-dev/sdk";
import { readNativeRows, type NativeRowIdentity } from "./next-bases-rows";

// Synthetic hydration consistency tests, not native READ/authority proof.
function identities(n: number): NativeRowIdentity[] {
  return Array.from({ length: n }, (_, i) => ({
    record:
      `00000000-0000-0000-0000-${(i + 1).toString(16).padStart(12, "0")}` as wire.Uuid,
    path: `tasks/task-${i + 1}.md`,
    sourceRevision: "ab".repeat(32) as wire.Hash,
  }));
}
function record(row: NativeRowIdentity): wire.RecordView {
  return {
    id: row.record,
    path: row.path,
    revision: row.sourceRevision,
    frontmatter: new Map(),
    types: [],
    state: { state: "confirmed", confirmedSeq: 1 },
  };
}
const signal = () => new AbortController().signal;

describe("selected native row hydration", () => {
  it("does not read a task index or source for an empty selection", async () => {
    const read = vi.fn();
    expect(await readNativeRows([], read, signal())).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps native order even when parallel record reads finish out of order", async () => {
    const rows = identities(3).reverse();
    const ordered = rows.map(record);
    const result = await readNativeRows(
      rows,
      async (id) => {
        const index = ordered.findIndex((row) => row.id === id);
        await new Promise((resolve) => setTimeout(resolve, (3 - index) * 2));
        return ordered[index]!;
      },
      signal(),
    );
    expect(result.map((row) => row.id)).toEqual(rows.map((row) => row.record));
  });

  it("uses fixed bounded fanout for a larger native selection", async () => {
    const rows = identities(25);
    const actual = new Map(rows.map((row) => [row.record, record(row)]));
    let active = 0;
    let peak = 0;
    let calls = 0;
    const result = await readNativeRows(
      rows,
      async (id) => {
        calls++;
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return actual.get(id)!;
      },
      signal(),
    );
    expect(peak).toBe(8);
    expect(calls).toBe(25);
    expect(result).toEqual(rows.map(record));
  });

  it.each([
    { id: identities(2)[1]!.record },
    { path: "reused/path.md" },
    { revision: "ef".repeat(32) as wire.Hash },
  ])("refuses identity drift without substituting a row", async (change) => {
    const rows = identities(1);
    await expect(
      readNativeRows(
        rows,
        async () => ({ ...record(rows[0]!), ...change }),
        signal(),
      ),
    ).rejects.toThrow("changed before task hydration");
  });

  it("does not deduplicate a malformed repeated native record silently", async () => {
    const row = identities(1)[0]!;
    const read = vi.fn();
    await expect(
      readNativeRows([row, { ...row }], read, signal()),
    ).rejects.toThrow("duplicate record identities");
    expect(read).not.toHaveBeenCalled();
  });

  it("copies selection identities before callbacks can mutate the caller's rows", async () => {
    const rows = identities(2);
    const actual = new Map(rows.map((row) => [row.record, record(row)]));
    const result = await readNativeRows(
      rows,
      async (id) => {
        rows[1]!.sourceRevision = "ef".repeat(32) as wire.Hash;
        rows[1]!.path = "changed.md";
        return actual.get(id)!;
      },
      signal(),
    );
    expect(result[1]!.path).toBe("tasks/task-2.md");
  });

  it("stops later reads and settles in-flight readers when a READ fails", async () => {
    const rows = identities(20);
    const failure = new Error("native READ refused");
    let calls = 0;
    await expect(
      readNativeRows(
        rows,
        async (id, current) => {
          calls++;
          if (id === rows[0]!.record) throw failure;
          await new Promise<never>((_, reject) => {
            current.addEventListener("abort", () => reject(current.reason), {
              once: true,
            });
          });
          return record(rows[0]!);
        },
        signal(),
      ),
    ).rejects.toBe(failure);
    expect(calls).toBeLessThanOrEqual(8);
  });

  it("checks cancellation before and after awaiting a selected record", async () => {
    const owner = new AbortController();
    owner.abort();
    const read = vi.fn();
    await expect(
      readNativeRows(identities(1), read, owner.signal),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const active = new AbortController();
    const rows = identities(1);
    await expect(
      readNativeRows(
        rows,
        async () => {
          active.abort();
          return record(rows[0]!);
        },
        active.signal,
      ),
    ).rejects.toThrow();
  });
});
