import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  RecordWriteStatus,
  RecordWriteTarget,
  TaskRepository,
} from "../application/ports/task-repository";
import { RecordWriteNotice } from "./record-write-notice";

// Component port stand-in only, never native admission/persistence evidence.
function fixture(
  initial?: RecordWriteStatus,
  target: RecordWriteTarget = { kind: "task", id: "task" },
) {
  let state = initial;
  const listeners = new Set<() => void>();
  const reconcile = vi.fn(async () => {});
  const repository = {
    writeState: vi.fn(() => state),
    reconcileWrites: reconcile,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as TaskRepository;
  render(<RecordWriteNotice repository={repository} target={target} />);
  return {
    repository,
    reconcile,
    set: (next?: RecordWriteStatus) =>
      act(() => {
        state = next;
        listeners.forEach((fn) => fn());
      }),
    listeners,
  };
}
it("distinguishes actual local capture from synchronization and clears after current-state notification", () => {
  const f = fixture("pending");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Saved locally · Waiting to sync",
  );
  f.set();
  expect(screen.queryByRole("status")).toBeNull();
});
it.each(["failed", "conflicted"] as const)(
  "shows %s without automatic replacement or a write retry",
  (state) => {
    const f = fixture(state);
    expect(screen.getByRole("status")).toHaveTextContent(
      state === "failed" ? "Change rejected" : "Conflicting changes",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(f.reconcile).not.toHaveBeenCalled();
  },
);
it.each(["scratchpad", "image"] as const)(
  "keeps the original %s metadata target distinct from a source path",
  (kind) => {
    const target = { kind, id: "original-portable-id" };
    const f = fixture("pending", target);
    expect(f.repository.writeState).toHaveBeenCalledWith(target);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved locally · Waiting to sync",
    );
    f.set("failed");
    expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
    expect(f.reconcile).not.toHaveBeenCalled();
  },
);
it("unknown outcome offers only an explicit read-only check", async () => {
  const f = fixture("unknown");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check save" }));
  });
  expect(f.reconcile).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("Save outcome unknown");
});
