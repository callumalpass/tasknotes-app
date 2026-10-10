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
it("restores production mark/copy/explainer and one styled sign-in action without technical controls", async () => {
  render(<CloudSignIn build={build} onCollection={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Sign in" });
  expect(button).toHaveClass("welcome-primary-action");
  expect(button.querySelector(".lucide-plus")).toBeNull();
  expect(button.querySelector(".lucide-arrow-right")).not.toBeNull();
  expect(
    screen.getByRole("heading", { name: "Connect TaskNotes to your tasks" }),
  ).toBeInTheDocument();
  expect(screen.getByText("What is mdbase?")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /resume|confirm account|refresh collections/i,
    }),
  ).not.toBeInTheDocument();
  expect(f.start).toHaveBeenCalledOnce();
  expect(f.openPopup).not.toHaveBeenCalled();
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
