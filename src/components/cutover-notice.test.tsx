import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resetMigratingBackoffForTests } from "./migrating-backoff";
import { cutoverProblemFrom } from "../application/cutover-problem";
import {
  CUTOVER_MESSAGES,
  cutoverRefusal,
  type CutoverFixtureKind,
} from "../test/cutover-fixtures";
import { CutoverNotice, type CutoverActions } from "./cutover-notice";

function problem(kind: CutoverFixtureKind, details?: Record<string, unknown>) {
  const value = cutoverProblemFrom(cutoverRefusal(kind, details));
  if (!value) throw new Error(`${kind} was not recognised`);
  return value;
}

function actions(native: boolean, save = () => Promise.resolve()) {
  return {
    isNative: () => native,
    openExternalUrl: vi.fn(() => Promise.resolve()),
    saveBeforeReload: vi.fn(save),
    reload: vi.fn(),
  } satisfies CutoverActions;
}

afterEach(() => {
  vi.useRealTimers();
  resetMigratingBackoffForTests();
});

describe.each(["moved", "onboarding_moved"] as const)("%s", (kind) => {
  it("shows the server message verbatim with Update instead of Retry", () => {
    const retry = vi.fn();
    render(
      <CutoverNotice
        actions={actions(false)}
        problem={problem(kind)}
        retry={retry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(CUTOVER_MESSAGES[kind]);
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Update TaskNotes" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /retry|try again/i }),
    ).toBeNull();
  });

  it("opens the update link in the native app", () => {
    const native = actions(true);
    render(<CutoverNotice actions={native} problem={problem(kind)} />);
    fireEvent.click(screen.getByRole("button", { name: "Update TaskNotes" }));
    expect(native.openExternalUrl).toHaveBeenCalledWith(
      "https://mdbase.dev/downloads",
    );
    expect(native.reload).not.toHaveBeenCalled();
    expect(native.saveBeforeReload).not.toHaveBeenCalled();
  });

  it("saves open drafts before reloading on the web", async () => {
    const web = actions(false);
    render(<CutoverNotice actions={web} problem={problem(kind)} />);
    fireEvent.click(screen.getByRole("button", { name: "Update TaskNotes" }));
    await waitFor(() => expect(web.reload).toHaveBeenCalledOnce());
    expect(web.saveBeforeReload).toHaveBeenCalledOnce();
    expect(web.openExternalUrl).not.toHaveBeenCalled();
  });
});

it("keeps the page open when a draft cannot be saved, and reloads only on request", async () => {
  const web = actions(false, () =>
    Promise.reject(
      new Error("Finish or discard the task you are adding before reloading."),
    ),
  );
  render(<CutoverNotice actions={web} problem={problem("moved")} />);
  fireEvent.click(screen.getByRole("button", { name: "Update TaskNotes" }));
  expect(
    await screen.findByText(
      "Finish or discard the task you are adding before reloading.",
    ),
  ).toBeVisible();
  expect(web.reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload anyway" }));
  expect(web.reload).toHaveBeenCalledOnce();
});

it("keeps the existing retry when a native update link is missing", () => {
  const retry = vi.fn();
  const moved = { ...problem("moved"), updateUrl: null };
  render(
    <CutoverNotice
      actions={actions(true)}
      problem={moved}
      retry={retry}
      retryLabel="Retry opening TaskNotes"
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(CUTOVER_MESSAGES.moved);
  expect(screen.queryByRole("button", { name: "Update TaskNotes" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry opening TaskNotes" }),
  );
  expect(retry).toHaveBeenCalledOnce();
});

describe("migrating", () => {
  it("is a calm status with a manual check", () => {
    const retry = vi.fn();
    render(
      <CutoverNotice
        actions={actions(false)}
        problem={problem("migrating")}
        retry={retry}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      CUTOVER_MESSAGES.migrating,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Update TaskNotes" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("checks again automatically with backoff, including across remounts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const retry = vi.fn();
    const view = render(
      <CutoverNotice
        autoRetry
        actions={actions(false)}
        problem={problem("migrating")}
        retry={retry}
      />,
    );
    expect(screen.getByText(/TaskNotes will keep checking/)).toBeVisible();
    await act(() => vi.advanceTimersByTime(29_999));
    expect(retry).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1));
    expect(retry).toHaveBeenCalledTimes(1);
    // A retry shows "Opening…" and then this notice again.
    view.unmount();
    render(
      <CutoverNotice
        autoRetry
        actions={actions(false)}
        problem={problem("migrating")}
        retry={retry}
      />,
    );
    await act(() => vi.advanceTimersByTime(59_999));
    expect(retry).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(1));
    expect(retry).toHaveBeenCalledTimes(2);
    vi.mocked(Math.random).mockRestore();
  });

  it("does not retry automatically inside the workspace", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    render(
      <CutoverNotice
        actions={actions(false)}
        problem={problem("migrating")}
        retry={retry}
      />,
    );
    await act(() => vi.advanceTimersByTime(600_000));
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("suspended", () => {
  it("shows the message without an update button", () => {
    render(
      <CutoverNotice actions={actions(true)} problem={problem("suspended")} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      CUTOVER_MESSAGES.suspended,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers support when the server provides a link", () => {
    const native = actions(true);
    render(
      <CutoverNotice
        actions={native}
        problem={problem("suspended", {
          support_url: "https://mdbase.dev/support",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(native.openExternalUrl).toHaveBeenCalledWith(
      "https://mdbase.dev/support",
    );
  });
});
