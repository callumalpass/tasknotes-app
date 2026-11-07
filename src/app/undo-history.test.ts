import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUndoHistory,
  forgetUndo,
  onUndoNotice,
  rememberUndo,
  takeUndo,
} from "./undo-history";

const entry = (label: string) => ({ label, run: vi.fn(async () => undefined) });

describe("undo history", () => {
  beforeEach(clearUndoHistory);

  it("returns the latest edit first", () => {
    rememberUndo(entry("first"));
    rememberUndo(entry("second"));
    expect(takeUndo()?.label).toBe("second");
    expect(takeUndo()?.label).toBe("first");
    expect(takeUndo()).toBeUndefined();
  });

  it("drops an edit undone from its toast", () => {
    const undone = entry("undone");
    rememberUndo(entry("earlier"));
    rememberUndo(undone);
    forgetUndo(undone);
    expect(takeUndo()?.label).toBe("earlier");
  });

  it("keeps the most recent twenty edits", () => {
    for (let index = 0; index < 25; index += 1)
      rememberUndo(entry(String(index)));
    const labels = [];
    for (let next = takeUndo(); next; next = takeUndo())
      labels.push(next.label);
    expect(labels).toHaveLength(20);
    expect(labels.at(-1)).toBe("5");
  });
});

it("announces only edits that carry a notice", () => {
  const heard = vi.fn();
  const stop = onUndoNotice(heard);
  rememberUndo(entry("quiet"));
  rememberUndo({ ...entry("loud"), notice: "Moved" });
  stop();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0].notice).toBe("Moved");
});
