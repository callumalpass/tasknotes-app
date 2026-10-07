import {
  describeHold,
  syncStatusText,
  type Hold,
  type SyncStatus,
} from "@mdbase-dev/sdk";
import type {
  HeldEdit,
  RepositoryConnectionStatus,
} from "../application/ports/task-repository";

export const HOLD_PREVIEW_CHARACTERS = 65_536;
/** Actual backend versions only. No filesystem access, blob fetch or guessed document. */
export function heldEditFromHold(hold: Hold, collectionId: string): HeldEdit {
  const canCompare =
    typeof hold.mine === "string" && typeof hold.theirs === "string";
  const presented = describeHold(hold, { collectionId, canCompare });
  return {
    id: presented.id,
    path: presented.path,
    title: presented.title,
    cause: presented.cause,
    detail: presented.detail,
    reversibleNote: presented.reversibleNote,
    since: new Date(presented.since).toISOString(),
    saves: presented.saves,
    actions: presented.actions.flatMap((option) =>
      option.resolution
        ? [
            {
              action: option.resolution,
              label: option.label,
              description: option.description,
              discardsMine: option.discardsMine,
            },
          ]
        : [],
    ),
    ...(canCompare
      ? {
          comparison: {
            mine: (hold.mine as string).slice(0, HOLD_PREVIEW_CHARACTERS),
            theirs: (hold.theirs as string).slice(0, HOLD_PREVIEW_CHARACTERS),
            shortened:
              (hold.mine as string).length > HOLD_PREVIEW_CHARACTERS ||
              (hold.theirs as string).length > HOLD_PREVIEW_CHARACTERS,
          },
        }
      : {
          comparisonUnavailable:
            hold.theirs === undefined
              ? "There is no synced version to compare against."
              : "Side-by-side text comparison is not available for these binary versions.",
        }),
  };
}
/** A cache open or a local-only status is not proof of a saved mutation. */
export function heldSyncFromStatus(
  status: SyncStatus,
): NonNullable<RepositoryConnectionStatus["sync"]> {
  return {
    text:
      status.mode === "local_only"
        ? `On this device, plus ${status.pending} pending, plus ${status.holds} held`
        : syncStatusText(status),
    pending: status.pending,
    held: status.holds,
  };
}
