import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  AppWebSignInSnapshot,
  AppWebSignInPortal,
} from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";
import { CloudSignIn } from "./cloud-sign-in";

// Production renderer with a public SDK/Worker stand-in. UI/control delegation
// only, not native sign-in, authority, storage or collection readiness proof.
const f = vi.hoisted(() => ({
  open: vi.fn(),
  start: vi.fn(),
  authorize: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
  renew: vi.fn(),
  openPopup: vi.fn(),
  closePopup: vi.fn(),
}));
vi.mock("../cloud/next-installation-worker", () => ({
  NextInstallationWorker: { openSession: f.open },
}));
vi.mock("../cloud/connect-popup", () => ({ openConnectPopup: f.openPopup }));
vi.mock("../cloud/use-session", () => ({
  useCloudSessionSnapshot: () => ({ status: "not_started", connections: [] }),
}));
const id = "11111111-1111-4111-8111-111111111111";
let value: AppWebSignInSnapshot;
let notify: () => void;
const build = { environment: "lab" } as NextInstallationBuildInput;
function initial(): AppWebSignInSnapshot {
  return {
    status: "signed_out",
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
    signIn: {
      requestId: id,
      installationId: id,
      deviceId: id,
      appId: id,
      kind: "app-runtime",
      verificationUri: `https://connect-lab.mdbase.dev/pair/${id}`,
      state: "pending",
      accountId: null,
      collectionIds: [],
      createCollections: false,
      requestedCreateCollections: true,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  value = initial();
  notify = () => {};
  f.close.mockResolvedValue(undefined);
  f.start.mockResolvedValue(value);
  f.authorize.mockResolvedValue(value);
  f.renew.mockResolvedValue(value);
  f.openPopup.mockReturnValue({ navigate: vi.fn(), close: f.closePopup });
  f.open.mockResolvedValue({
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
    startSession: f.start,
    authorizeSession: f.authorize,
    selectSession: f.select,
    renewSession: f.renew,
    close: f.close,
    reservePortal: (open: () => AppWebSignInPortal) => {
      open();
    },
    closePortal: f.closePopup,
  });
});
it.each([
  "binding",
  "response",
  "refused",
  "expired",
  "recovery_required",
  "account_confirmation_required",
  "outcome_unknown",
])(
  "shows the known %s failure and logs only its code, closing the display popup",
  async (reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.authorize.mockRejectedValue(
      Object.assign(Error("private-response-token"), { reason }),
    );
    render(<CloudSignIn build={build} onCollection={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("private-response-token");
    expect(alert).not.toHaveTextContent("Sign-in was interrupted");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `[TaskNotes sign-in] authorize: ${reason}`,
    );
    expect(f.closePopup).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    warn.mockRestore();
  },
);
it("reports a snapshot failure once without logging its display/account fields", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  await screen.findByRole("button", { name: "Sign in" });
  act(() => {
    value = { ...value, status: "blocked", problem: "refused" };
    notify();
    notify();
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("refused access");
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    "[TaskNotes sign-in] snapshot: refused",
  );
  warn.mockRestore();
});
it("reserves the popup synchronously before delegating the one SDK authorize action", async () => {
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(f.openPopup).toHaveBeenCalledOnce();
  expect(f.authorize).toHaveBeenCalledOnce();
  expect(f.openPopup.mock.invocationCallOrder[0]).toBeLessThan(
    f.authorize.mock.invocationCallOrder[0]!,
  );
});
it("uses actual snapshot pushes for approval waiting and genuine signed-in email without manual receipt controls", async () => {
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  await screen.findByRole("button", { name: "Sign in" });
  act(() => {
    value = { ...value, status: "authorizing" };
    notify();
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for approval in the mdbase window…",
  );
  act(() => {
    value = {
      ...value,
      status: "unselected",
      signIn: {
        ...value.signIn!,
        state: "paired",
        accountId: id,
        accountEmail: "person@example.test",
      },
    };
    notify();
  });
  expect(
    screen.getByText("Signed in as person@example.test"),
  ).toBeInTheDocument();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.start).toHaveBeenCalledOnce();
});
it("shows the canonical authenticated GitHub login without inventing an email or another account", async () => {
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  await screen.findByRole("button", { name: "Sign in" });
  act(() => {
    value = {
      ...value,
      status: "unselected",
      signIn: {
        ...value.signIn!,
        state: "paired",
        accountId: id,
        accountEmail: null,
        accountProvider: "github",
        accountLogin: "test-login",
      },
    };
    notify();
  });
  expect(
    screen.getByText("Signed in as test-login (GitHub)"),
  ).toBeInTheDocument();
  expect(value.signIn?.accountId).toBe(id);
  expect(value.signIn?.accountEmail).toBeNull();
  expect(screen.queryByText(/test-login@/)).not.toBeInTheDocument();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledOnce();
});
it("does not display unconfirmed provider metadata", async () => {
  value = {
    ...initial(),
    signIn: {
      ...initial().signIn!,
      accountProvider: "github",
      accountLogin: "test-login",
    },
  };
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
});
it("blocked popup creates no SDK authorization or alternative original device", async () => {
  f.openPopup.mockImplementation(() => {
    throw Error("blocked");
  });
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your browser blocked the sign-in window.",
  );
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledOnce();
});
it("explicit expiry renewal uses the same owner and already-reserved popup, not a fresh open", async () => {
  value = { ...initial(), status: "blocked", problem: "expired" };
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(f.authorize).toHaveBeenCalledOnce());
  expect(f.renew).toHaveBeenCalledOnce();
  expect(f.open).toHaveBeenCalledOnce();
  expect(f.openPopup.mock.invocationCallOrder[0]).toBeLessThan(
    f.renew.mock.invocationCallOrder[0]!,
  );
});
it("uses approved SDK collection choices without inventing hosted/computer metadata or legacy setup reviews", async () => {
  value = {
    ...initial(),
    status: "unselected",
    collections: [{ collectionId: id, displayName: "Work", role: "owner" }],
    signIn: {
      ...initial().signIn!,
      state: "paired",
      accountId: id,
      accountEmail: null,
    },
  };
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Work" }));
  await waitFor(() => expect(f.select).toHaveBeenCalledExactlyOnceWith(id));
  expect(screen.queryByText("Hosted by mdbase")).not.toBeInTheDocument();
  expect(screen.queryByText("Connected computer")).not.toBeInTheDocument();
  expect(screen.queryByText("Review updated access")).not.toBeInTheDocument();
});
it("unmount closes the owned lifetime without asking for a fresh sign-in or silently discarding saved collection changes", async () => {
  const { unmount } = render(
    <CloudSignIn build={build} onCollection={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Sign in" });
  unmount();
  await waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  expect(f.open).toHaveBeenCalledOnce();
  expect(f.authorize).not.toHaveBeenCalled();
});

it.each([
  ["blocked", "outcome_unknown"],
  ["unselected", "unavailable"],
] as const)(
  "%s/%s offers explicit same-target Retry without a replacement authorization",
  async (status, problem) => {
    value = {
      ...initial(),
      status,
      problem,
      selectedCollectionId: id,
      collections: [
        { collectionId: id, displayName: "Original collection", role: "owner" },
      ],
      signIn: { ...initial().signIn!, state: "paired", accountId: id },
    };
    let finish!: () => void;
    f.select.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<CloudSignIn build={build} onCollection={vi.fn()} />);
    const retry = await screen.findByRole("button", { name: /^Retry$/ });
    expect(f.select).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(f.select).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.renew).not.toHaveBeenCalled();
    expect(f.openPopup).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Complete your selection in the mdbase window."),
    ).not.toBeInTheDocument();
    await act(async () => finish());
    expect(retry).toBeEnabled();
    warn.mockRestore();
  },
);

it.each(["recovery_required", "refused", "fenced"])(
  "does not offer collection recovery for terminal %s",
  async (problem) => {
    value = {
      ...initial(),
      status: "blocked",
      problem,
      selectedCollectionId: id,
      collections: [
        { collectionId: id, displayName: "Original collection", role: "owner" },
      ],
      signIn: { ...initial().signIn!, state: "paired", accountId: id },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<CloudSignIn build={build} onCollection={vi.fn()} />);
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /^Retry$/ }),
    ).not.toBeInTheDocument();
    expect(f.select).not.toHaveBeenCalled();
    warn.mockRestore();
  },
);

it.each(["unpaired", "missing_target", "not_approved"])(
  "does not infer a recoverable collection from %s metadata",
  async (missing) => {
    value = {
      ...initial(),
      status: "blocked",
      problem: "outcome_unknown",
      selectedCollectionId: missing === "missing_target" ? null : id,
      collections:
        missing === "not_approved"
          ? []
          : [
              {
                collectionId: id,
                displayName: "Original collection",
                role: "owner",
              },
            ],
      signIn: {
        ...initial().signIn!,
        state: missing === "unpaired" ? "pending" : "paired",
        accountId: id,
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<CloudSignIn build={build} onCollection={vi.fn()} />);
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /^Retry$/ }),
    ).not.toBeInTheDocument();
    expect(f.select).not.toHaveBeenCalled();
    warn.mockRestore();
  },
);
