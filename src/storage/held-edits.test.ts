import { describe, expect, it } from "vitest";
import type { BlobRef, Hold, HoldReason, SyncStatus } from "@mdbase-dev/sdk";
import {
  heldEditFromHold,
  heldSyncFromStatus,
  HOLD_PREVIEW_CHARACTERS,
} from "./held-edits";
const COLLECTION = "00000000-0000-4000-8000-000000000001";
const hold: Hold = {
  id: "00000000-0000-4000-8000-000000000002",
  path: "notes/task.md",
  reason: "conflict",
  since: 1_800_000_000_000,
  mine: "held text",
  theirs: "confirmed text",
  saves: 2,
};
const blob: BlobRef = {
  plainHash: `sha256:${"00".repeat(32)}`,
  blobId: new Uint8Array(32),
  size: 17,
  idEpoch: 1,
  partSize: 17,
};
describe("held-edit projection", () => {
  it.each<HoldReason>([
    "conflict",
    "unknown_provenance",
    "deleted_elsewhere",
    "read_only",
    "editor_busy",
    "suspect_write",
  ])("uses the SDK cause and reversible choices for %s", (reason) => {
    const edit = heldEditFromHold({ ...hold, reason }, COLLECTION);
    expect(edit.title).toBe("mdbase protected your edit");
    expect(edit.cause.length).toBeGreaterThan(20);
    expect(edit.detail).not.toContain("stuck");
    expect(edit.reversibleNote).toContain("change your mind later");
    expect(edit.id).toBe(hold.id);
    expect(edit.since).toBe(new Date(hold.since).toISOString());
    expect(
      edit.actions.every((a) =>
        ["keep_mine", "take_theirs", "keep_both", "delete", "use"].includes(
          a.action,
        ),
      ),
    ).toBe(true);
  });
  it("keeps text versions exact and read-only, including HTML-looking content", () => {
    const mine = "<script>not executed</script>\n# Private text";
    const edit = heldEditFromHold({ ...hold, mine, theirs: "" }, COLLECTION);
    expect(edit.comparison).toEqual({ mine, theirs: "", shortened: false });
    expect(
      edit.actions.find((a) => a.action === "take_theirs")?.discardsMine,
    ).toBe(true);
  });
  it("bounds both previews and explicitly marks shortening without changing the source", () => {
    const input = {
      ...hold,
      mine: "M".repeat(HOLD_PREVIEW_CHARACTERS + 1),
      theirs: "T".repeat(HOLD_PREVIEW_CHARACTERS + 2),
    };
    const edit = heldEditFromHold(input, COLLECTION);
    expect(edit.comparison?.mine.length).toBe(HOLD_PREVIEW_CHARACTERS);
    expect(edit.comparison?.theirs.length).toBe(HOLD_PREVIEW_CHARACTERS);
    expect(edit.comparison?.shortened).toBe(true);
    expect(input.mine.length).toBe(HOLD_PREVIEW_CHARACTERS + 1);
  });
  it("never fabricates or fetches binary/deleted versions", () => {
    const binary = heldEditFromHold({ ...hold, mine: blob }, COLLECTION);
    expect(binary.comparison).toBeUndefined();
    expect(binary.comparisonUnavailable).toContain("binary");
    const deleted = heldEditFromHold(
      { ...hold, reason: "deleted_elsewhere", theirs: undefined },
      COLLECTION,
    );
    expect(deleted.comparison).toBeUndefined();
    expect(deleted.comparisonUnavailable).toContain("no synced version");
    expect(deleted.actions.map((a) => a.action)).toEqual([
      "keep_mine",
      "delete",
    ]);
  });
});

it("shows confirmed/pending/held counts without treating a local cache as saved", () => {
  const status: SyncStatus = {
    mode: "synced",
    confirmedThrough: 8,
    headKnown: 10,
    pending: 2,
    holds: 1,
    unresolved: 0,
    connection: "offline",
    incidents: [],
  };
  expect(heldSyncFromStatus(status)).toEqual({
    text: "Confirmed through 8, plus 2 pending, plus 1 held",
    pending: 2,
    held: 1,
  });
  expect(
    heldSyncFromStatus({ ...status, mode: "local_only" }).text,
  ).not.toMatch(/saved|confirmed/i);
});
