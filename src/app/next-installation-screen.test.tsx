import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppInstallationSignInView } from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";
import { NextInstallationScreen } from "./next-installation-screen";

const transport = vi.hoisted(() => ({
  open: vi.fn(),
  start: vi.fn(),
  exchange: vi.fn(),
  confirmAccount: vi.fn(),
  attest: vi.fn(),
  renewExpiredPairing: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../cloud/next-installation-worker", () => ({
  NextInstallationWorker: { open: transport.open },
}));
const account = "11111111-1111-4111-8111-111111111111";
const parent: AppInstallationSignInView = {
  requestId: account,
  installationId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
  appId: "tasknotes-web",
  kind: "app-runtime",
  verificationUri: `https://connect-lab.mdbase.dev/pair/${account}`,
  state: "pending",
  accountId: null,
  collectionIds: [],
  createCollections: false,
  requestedCreateCollections: false,
};
const child = {
  ...parent,
  requestId: "44444444-4444-4444-8444-444444444444",
  verificationUri:
    "https://connect-lab.mdbase.dev/pair/44444444-4444-4444-8444-444444444444",
};
const build = { environment: "lab" } as NextInstallationBuildInput;
const retryName = "Start a new sign-in request on this device";
const resumeName = "Retry original sign-in request";
const expired = () => Error("TaskNotes native sign-in: expired");
beforeEach(() => {
  vi.resetAllMocks();
  transport.open.mockResolvedValue({ worker: transport, view: parent });
  transport.start.mockResolvedValue(parent);
  transport.exchange.mockResolvedValue(parent);
  transport.renewExpiredPairing.mockResolvedValue(child);
  transport.confirmAccount.mockResolvedValue({
    ...parent,
    accountId: account,
    state: "account_confirmed",
  });
  transport.close.mockResolvedValue(undefined);
});
async function open() {
  render(<NextInstallationScreen build={build} onCollection={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Resume this device's original sign-in",
    }),
  );
  await waitFor(() => expect(transport.start).toHaveBeenCalledOnce());
}
describe("explicit expired pairing UI (DOM/Worker stand-ins, not LAB)", () => {
  it("offers renewal only after typed expiry, never automatically, and hides stale portal actions", async () => {
    transport.start.mockRejectedValueOnce(expired());
    await open();
    const retry = await screen.findByRole("button", { name: retryName });
    expect(screen.getByRole("alert")).toHaveTextContent("request expired");
    expect(transport.renewExpiredPairing).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check original approval" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: resumeName }),
    ).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        child.verificationUri,
      ),
    );
    expect(transport.renewExpiredPairing).toHaveBeenCalledOnce();
    expect(transport.open).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: retryName }),
    ).not.toBeInTheDocument();
  });
  it.each(["refused", "outcome_unknown", "response"])(
    "%s does not offer new pairing",
    async (reason) => {
      transport.start.mockRejectedValueOnce(
        Error(`TaskNotes native sign-in: ${reason}`),
      );
      await open();
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("button", { name: retryName }),
      ).not.toBeInTheDocument();
      expect(transport.renewExpiredPairing).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: resumeName }));
      await waitFor(() => expect(transport.start).toHaveBeenCalledTimes(2));
      expect(transport.open).toHaveBeenCalledOnce();
    },
  );
  it("unknown successor outcome resumes SAME child without a second renewal or expired link", async () => {
    transport.start.mockRejectedValueOnce(expired());
    transport.renewExpiredPairing.mockRejectedValueOnce(
      Error("TaskNotes native sign-in: outcome_unknown"),
    );
    await open();
    fireEvent.click(await screen.findByRole("button", { name: retryName }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("outcome_unknown"),
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: retryName }),
    ).not.toBeInTheDocument();
    transport.start.mockResolvedValueOnce(child);
    fireEvent.click(screen.getByRole("button", { name: resumeName }));
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        child.verificationUri,
      ),
    );
    expect(transport.start).toHaveBeenCalledTimes(2);
    expect(transport.renewExpiredPairing).toHaveBeenCalledOnce();
    expect(transport.open).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
  });
  it("keeps confirmed native device ownership when exchange expires", async () => {
    const selected = {
      ...parent,
      accountId: account,
      state: "account_selected" as const,
    };
    transport.start.mockResolvedValueOnce(selected);
    await open();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Confirm this account on this device",
      }),
    );
    await screen.findByRole("button", {
      name: "Send original device approval",
    });
    transport.exchange.mockRejectedValueOnce(expired());
    fireEvent.click(
      screen.getByRole("button", { name: "Check original approval" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: retryName }));
    await screen.findByRole("button", {
      name: "Send original device approval",
    });
    expect(transport.confirmAccount).toHaveBeenCalledOnce();
    expect(transport.open).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
    expect(transport.attest).not.toHaveBeenCalled();
  });
});
