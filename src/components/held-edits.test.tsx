import { StrictMode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HeldEdit,
  TaskRepository,
} from "../application/ports/task-repository";
import { HeldEditsNotice, HeldEditsReview } from "./held-edits";
const state = vi.hoisted(() => ({
  repository: { resolveHeldEdit: vi.fn() } as Pick<
    TaskRepository,
    "resolveHeldEdit"
  >,
  refresh: vi.fn(),
}));
vi.mock("../app/repository-context", () => ({ useRepository: () => state }));
const edit: HeldEdit = {
  id: "hold-id",
  path: "notes/task.md",
  title: "mdbase protected your edit",
  cause: "This file was changed on another device.",
  detail: "Your version is kept here until you choose.",
  reversibleNote:
    "You can change your mind later. Keep both to keep your version as a file.",
  since: "2026-10-07T00:00:00Z",
  saves: 2,
  actions: [
    {
      action: "take_theirs",
      label: "Take theirs",
      description: "Replace this file with the synced version.",
      discardsMine: true,
    },
    {
      action: "keep_both",
      label: "Keep both",
      description: "Keep your version as a copy.",
      discardsMine: false,
    },
    {
      action: "keep_mine",
      label: "Keep mine",
      description: "Submit your version.",
      discardsMine: false,
    },
  ],
  comparison: {
    mine: "<img src=x onerror=alert(1)>",
    theirs: "Synced text",
    shortened: false,
  },
};
beforeEach(() => {
  state.repository = { resolveHeldEdit: vi.fn().mockResolvedValue(undefined) };
  state.refresh = vi.fn().mockResolvedValue(undefined);
});
describe("protected-edit review", () => {
  it("shows cause and reversibility, with preserving choices before discarding", () => {
    render(<HeldEditsReview edits={[edit]} />);
    expect(screen.getByText(edit.cause)).toBeVisible();
    expect(screen.getByText(edit.reversibleNote)).toBeVisible();
    const buttons = within(
      screen.getByRole("region", { name: "Protected edits" }),
    )
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(buttons.indexOf("Keep both")).toBeLessThan(
      buttons.indexOf("Take theirs"),
    );
  });
  it("compares actual text as escaped, read-only content and never writes a preview", () => {
    const { container } = render(<HeldEditsReview edits={[edit]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Compare side by side" }),
    );
    expect(screen.getByLabelText("Your protected version")).toHaveValue(
      edit.comparison!.mine,
    );
    expect(screen.getByLabelText("Synced version")).toHaveValue("Synced text");
    expect(screen.getByLabelText("Your protected version")).toHaveAttribute(
      "readonly",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(state.repository.resolveHeldEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(
      screen.queryByLabelText("Your protected version"),
    ).not.toBeInTheDocument();
  });
  it("requires confirmation before replacing held bytes and allows cancellation", async () => {
    render(<HeldEditsReview edits={[edit]} />);
    fireEvent.click(screen.getByRole("button", { name: "Take theirs" }));
    expect(state.repository.resolveHeldEdit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This discards your protected version/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Confirm take theirs" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take theirs" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm take theirs" }),
    );
    await waitFor(() =>
      expect(state.repository.resolveHeldEdit).toHaveBeenCalledWith(
        edit.id,
        "take_theirs",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "may still be pending sync",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("saved");
  });
  it("does not expose a stale destructive choice after backend actions change", () => {
    const view = render(<HeldEditsReview edits={[edit]} />);
    fireEvent.click(screen.getByRole("button", { name: "Take theirs" }));
    view.rerender(
      <HeldEditsReview
        edits={[
          {
            ...edit,
            actions: edit.actions.filter((a) => a.action !== "take_theirs"),
          },
        ]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm take theirs" }),
    ).not.toBeInTheDocument();
    expect(state.repository.resolveHeldEdit).not.toHaveBeenCalled();
  });
  it("contains uncertain outcomes and refresh failure without automatic resolution retry", async () => {
    vi.mocked(state.repository.resolveHeldEdit!).mockRejectedValueOnce(
      new Error("secret remote detail"),
    );
    render(<HeldEditsReview edits={[edit]} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm the outcome",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "secret remote detail",
    );
    expect(state.repository.resolveHeldEdit).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
    state.refresh.mockRejectedValueOnce(new Error("status unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
    expect(
      await screen.findByText(/latest status could not be read/),
    ).toBeVisible();
    expect(state.repository.resolveHeldEdit).toHaveBeenCalledTimes(2);
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("retires late outcomes on owner switch and leaves the new owner usable", async () => {
    let finish!: () => void;
    const old = vi.fn().mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    state.repository = { resolveHeldEdit: old };
    const view = render(<HeldEditsReview edits={[edit]} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    const current = vi.fn().mockResolvedValue(undefined);
    state.repository = { resolveHeldEdit: current };
    view.rerender(<HeldEditsReview edits={[edit]} />);
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep mine" })).toBeEnabled(),
    );
    expect(state.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(current).toHaveBeenCalledOnce());
  });
  it("blocks duplicate dispatch under StrictMode and disables unsupported resolution", async () => {
    let finish!: () => void;
    vi.mocked(state.repository.resolveHeldEdit!).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(
      <StrictMode>
        <HeldEditsReview edits={[edit]} />
      </StrictMode>,
    );
    const keep = screen.getByRole("button", { name: "Keep mine" });
    fireEvent.click(keep);
    fireEvent.click(keep);
    expect(state.repository.resolveHeldEdit).toHaveBeenCalledOnce();
    finish();
    await screen.findByRole("status");
    state.repository = {};
    view.rerender(<HeldEditsReview edits={[edit]} />);
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("marks shortened previews and explains missing versions instead of inventing them", () => {
    const view = render(
      <HeldEditsReview
        edits={[
          { ...edit, comparison: { ...edit.comparison!, shortened: true } },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Compare side by side" }),
    );
    expect(screen.getByText(/previews are shortened/)).toBeVisible();
    view.rerender(
      <HeldEditsReview
        edits={[
          {
            ...edit,
            comparison: undefined,
            comparisonUnavailable: "Binary comparison unavailable.",
          },
        ]}
      />,
    );
    expect(screen.getByText("Binary comparison unavailable.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Compare side by side" }),
    ).not.toBeInTheDocument();
  });
});
it("keeps the shell notice actionable for known holds or a count arriving before details", () => {
  const review = vi.fn();
  const view = render(<HeldEditsNotice edits={[edit]} onReview={review} />);
  expect(screen.getByRole("status")).toHaveTextContent(edit.cause);
  fireEvent.click(
    screen.getByRole("button", { name: "Review protected edits" }),
  );
  expect(review).toHaveBeenCalledOnce();
  view.rerender(<HeldEditsNotice edits={[]} count={2} />);
  expect(screen.getByRole("status")).toHaveTextContent("2 edits");
  view.rerender(<HeldEditsNotice edits={[]} />);
  expect(screen.queryByRole("status")).toBeNull();
});
