import { describe, expect, it } from "vitest";
import { scratchFeedPage, scratchpadFeedItem } from "./scratch-feed";
import type { ScratchpadDocument } from "./scratchpad";
import type { ScratchImage } from "./scratch-image";

const current: ScratchpadDocument = {
  id: "current",
  path: "scratchpads/current.md",
  revision: "1",
  state: "active",
  dateCreated: "2026-03-01T12:00:00.000Z",
  dateModified: "2026-03-01T12:00:00.000Z",
  body: "",
};

function note(id: string, dateCreated: string): ScratchpadDocument {
  return {
    ...current,
    id,
    path: `scratchpads/${id}.md`,
    state: "converted",
    dateCreated,
  };
}
function image(id: string, dateCreated: string): ScratchImage {
  return {
    kind: "image",
    id,
    path: `scratch-images/${id}.md`,
    revision: "1",
    dateCreated,
    dateModified: dateCreated,
    file: `Scratchpad Images/${id}.png`,
    digest: `sha256:${"0".repeat(64)}`,
    size: 3,
    mediaType: "image/png",
  };
}

describe("scratchFeedPage", () => {
  it("merges images by creation and notes by latest-history activity", () => {
    const recentlyUsed = {
      ...note("old", "2026-01-01T00:00:00.000Z"),
      dateConverted: "2026-02-02T00:00:00.000Z",
    };
    const page = scratchFeedPage(current, [
      scratchpadFeedItem(recentlyUsed),
      image("middle", "2026-02-01T00:00:00.000Z"),
      scratchpadFeedItem(current),
    ]);
    expect(page.current.id).toBe("current");
    expect(page.items.map((item) => [item.kind, item.id])).toEqual([
      ["scratchpad", "old"],
      ["image", "middle"],
    ]);
  });

  it("uses a deterministic stable continuation", () => {
    const items = [
      image("c", "2026-03-01T00:00:00.000Z"),
      image("b", "2026-02-01T00:00:00.000Z"),
      image("a", "2026-01-01T00:00:00.000Z"),
    ];
    const first = scratchFeedPage(current, items, { limit: 2 });
    expect(first.nextCursor).toBeTruthy();
    expect(
      scratchFeedPage(current, items, {
        limit: 2,
        cursor: first.nextCursor,
      }).items.map((item) => item.id),
    ).toEqual(["a"]);
  });
});
