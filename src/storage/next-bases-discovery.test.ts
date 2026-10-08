import { describe, expect, it, vi } from "vitest";
import type { wire } from "@mdbase-dev/sdk";
import {
  iterateNativeDiscovery,
  nativeViewSelection,
  type NativeDiscoveryPage,
  type NativeViewIdentity,
} from "./next-bases-discovery";

// Synthetic sequencing fixtures only; not native catalog/authority proof.
const source: NativeViewIdentity = {
  record: "00000000-0000-0000-0000-000000000001" as wire.Uuid,
  path: "views/tasks.base",
  sourceRevision: "ab".repeat(32) as wire.Hash,
  ordinal: 0,
};
function page(
  views: NativeViewIdentity[],
  continuation: Uint8Array | null = null,
): NativeDiscoveryPage<NativeViewIdentity> {
  return {
    views,
    continuation,
    collectionRevision: "cd".repeat(32) as wire.Hash,
    clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
  };
}
const signal = () => new AbortController().signal;
async function collect(read: Parameters<typeof iterateNativeDiscovery>[0]) {
  const values: NativeViewIdentity[] = [];
  for await (const views of iterateNativeDiscovery(read, signal()))
    values.push(...views);
  return values;
}

describe("native discovery sequencing", () => {
  it("advances an empty progress page until explicit null EOF, preserving ordinals", async () => {
    const first = new Uint8Array(32).fill(1);
    const next = new Uint8Array(32).fill(2);
    const pages = [
      page([], first),
      page([{ ...source }], next),
      page([{ ...source, ordinal: 3 }]),
    ];
    const read = vi.fn(async () => pages.shift()!);
    const result = await collect(read);
    expect(result.map(nativeViewSelection)).toEqual([
      nativeViewSelection(source),
      { ...nativeViewSelection(source), ordinal: 3 },
    ]);
    expect(read.mock.calls).toHaveLength(3);
  });

  it("uses the original source UUID/SHA/ordinal, not a path or repeated display name", () => {
    expect(
      nativeViewSelection({ ...source, path: "reused/path.base" }),
    ).toEqual({
      record: source.record,
      sourceRevision: source.sourceRevision,
      ordinal: 0,
    });
  });

  it.each([
    (p: NativeDiscoveryPage<NativeViewIdentity>) => {
      p.collectionRevision = "ef".repeat(32) as wire.Hash;
    },
    (p: NativeDiscoveryPage<NativeViewIdentity>) => {
      p.clock.instant++;
    },
    (p: NativeDiscoveryPage<NativeViewIdentity>) => {
      p.clock.tz = "Europe/London";
    },
    (p: NativeDiscoveryPage<NativeViewIdentity>) => {
      p.clock.localDate = "1970-01-02";
    },
  ])(
    "refuses cut drift rather than restarting or publishing a partial catalog",
    async (drift) => {
      const last = page([{ ...source, ordinal: 1 }]);
      drift(last);
      const pages = [page([{ ...source }], new Uint8Array(32)), last];
      await expect(collect(async () => pages.shift()!)).rejects.toThrow(
        "captured cut",
      );
    },
  );

  it.each([
    { ordinal: 0 },
    { sourceRevision: "ef".repeat(32) as wire.Hash },
    { path: "moved.base" },
    { record: "00000000-0000-0000-0000-000000000000" as wire.Uuid },
  ])("refuses cross-page source or frontier drift", async (change) => {
    const pages = [
      page([{ ...source }], new Uint8Array(32)),
      page([{ ...source, ordinal: 1, ...change }]),
    ];
    await expect(collect(async () => pages.shift()!)).rejects.toThrow(
      "source frontier",
    );
  });

  it("copies the previous identity and cut before yielding consumer-owned data", async () => {
    const first = page([{ ...source }], new Uint8Array(32));
    const last = page([{ ...source, ordinal: 3 }]);
    const pages = [first, last];
    const iterator = iterateNativeDiscovery(
      async () => pages.shift()!,
      signal(),
    )[Symbol.asyncIterator]();
    await iterator.next();
    first.views[0]!.ordinal = 99;
    first.clock.instant = 99;
    expect((await iterator.next()).value?.[0]?.ordinal).toBe(3);
    expect((await iterator.next()).done).toBe(true);
  });

  it("checks cancellation before starting and after awaiting the native page", async () => {
    const owner = new AbortController();
    owner.abort();
    const read = vi.fn(async () => page([]));
    const iterator = iterateNativeDiscovery(read, owner.signal)[
      Symbol.asyncIterator
    ]();
    await expect(iterator.next()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const current = new AbortController();
    const after = iterateNativeDiscovery(async () => {
      current.abort();
      return page([{ ...source }]);
    }, current.signal)[Symbol.asyncIterator]();
    await expect(after.next()).rejects.toThrow();
  });
});
