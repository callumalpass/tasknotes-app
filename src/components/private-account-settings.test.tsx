import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PrivateAccount,
  memorySecretStore,
  passwordStrength,
} from "@mdbase-dev/sdk/account";
import type {
  AccountKeyControlPort,
  PrivateAccountStatus,
} from "@mdbase-dev/sdk/account";
import {
  PrivateAccountSettings,
  type PrivateAccountUi,
} from "./private-account-settings";

const PASSWORD = "correct horse battery staple";
const RECOVERY = "MDB1-test-once-only";
function service(
  initial: PrivateAccountStatus = { mode: "none", version: 0, unlocked: false },
) {
  let state = initial;
  const account: PrivateAccountUi = {
    status: vi.fn(async () => state),
    passwordStrength,
    setup: vi.fn(async () => {
      state = { mode: "password", version: 1, unlocked: true };
      return { recoveryKey: RECOVERY };
    }),
    unlock: vi.fn(async () => {
      state = { ...state, unlocked: true };
      return {};
    }),
    recover: vi.fn(async () => {
      state = { ...state, unlocked: true };
      return {};
    }),
    changePassword: vi.fn(async () => {}),
    enableStrict: vi.fn(async () => ({
      version: 2,
      alreadyStrict: false,
      complete: false,
      pending: [],
      accountKeyKept: true,
      revocations: [],
    })),
    lock: vi.fn(async () => {
      state = { ...state, unlocked: false };
    }),
  };
  return {
    account,
    setStatus: (next: PrivateAccountStatus) => {
      state = next;
    },
  };
}
function fillNewPassword(value = PASSWORD) {
  fireEvent.change(screen.getByLabelText("New recovery password"), {
    target: { value },
  });
  fireEvent.change(screen.getByLabelText("Confirm new recovery password"), {
    target: { value },
  });
}

describe("PrivateAccountSettings", () => {
  it("sets up only with a strong matching password, clears inputs, and shows recovery once", async () => {
    const { account } = service();
    render(<PrivateAccountSettings account={account} />);
    const button = await screen.findByRole("button", {
      name: "Set up recovery",
    });
    fillNewPassword("password1234");
    expect(button).toBeDisabled();
    fillNewPassword();
    fireEvent.change(screen.getByLabelText("Confirm new recovery password"), {
      target: { value: "different" },
    });
    expect(button).toBeDisabled();
    fillNewPassword();
    fireEvent.click(button);
    expect(
      await screen.findByLabelText("Recovery key (shown once)"),
    ).toHaveValue(RECOVERY);
    expect(account.setup).toHaveBeenCalledWith(
      PASSWORD,
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByLabelText("New recovery password"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "I saved my recovery key" }),
    );
    expect(screen.queryByDisplayValue(RECOVERY)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Recovery password")).toHaveValue("");
  });
  it("unlocks with a password or recovery key without persisting a UI draft", async () => {
    const f = service({ mode: "password", version: 1, unlocked: false });
    render(<PrivateAccountSettings account={f.account} />);
    await screen.findByText("Locked on this device");
    fireEvent.change(screen.getByLabelText("Recovery password"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock private collections" }),
    );
    await screen.findByText("Unlocked on this device");
    expect(f.account.unlock).toHaveBeenCalledWith(
      { password: PASSWORD },
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText("Recovery password")).toHaveValue("");
    fireEvent.change(
      screen.getByLabelText("Recovery key (or use your password)"),
      { target: { value: RECOVERY } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock private collections" }),
    );
    await waitFor(() =>
      expect(f.account.unlock).toHaveBeenCalledWith(
        { recoveryKey: RECOVERY },
        expect.any(AbortSignal),
      ),
    );
  });
  it("offers recovery and password change as distinct SDK operations", async () => {
    const f = service({ mode: "password", version: 1, unlocked: true });
    render(<PrivateAccountSettings account={f.account} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Forgot password" }),
    );
    fireEvent.change(screen.getByLabelText("Recovery key"), {
      target: { value: RECOVERY },
    });
    fillNewPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "Recover account access" }),
    );
    await waitFor(() =>
      expect(f.account.recover).toHaveBeenCalledWith(
        RECOVERY,
        PASSWORD,
        expect.any(AbortSignal),
      ),
    );
    await screen.findByText(
      "Account unlocked. Private collection keys are available on this device.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    fillNewPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "Change recovery password" }),
    );
    await screen.findByText(
      "Recovery password changed. Your recovery key is unchanged.",
    );
    expect(f.account.changePassword).toHaveBeenCalledWith(
      PASSWORD,
      expect.any(AbortSignal),
    );
  });
  it("reports partial key access instead of claiming every collection unlocked", async () => {
    const f = service({ mode: "password", version: 1, unlocked: false });
    vi.mocked(f.account.unlock).mockResolvedValueOnce({
      incomplete: ["a", "b"],
    });
    render(<PrivateAccountSettings account={f.account} />);
    await screen.findByText("Locked on this device");
    fireEvent.change(screen.getByLabelText("Recovery password"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock private collections" }),
    );
    expect(
      await screen.findByText(
        /2 private collections still need to finish key access/,
      ),
    ).toBeVisible();
  });
  it("requires strict trade-off consent and displays CP pending/retention honestly", async () => {
    const f = service({ mode: "password", version: 1, unlocked: true });
    vi.mocked(f.account.enableStrict).mockImplementationOnce(async () => {
      f.setStatus({
        mode: "strict",
        version: 2,
        unlocked: false,
        strictComplete: false,
        pending: [
          { collectionId: "elsewhere", deviceId: "target", revokedAt: null },
        ],
        accountKeyKept: true,
      });
      return {
        version: 2,
        complete: false,
        pending: [
          { collectionId: "elsewhere", deviceId: "target", revokedAt: null },
        ],
        accountKeyKept: true,
        alreadyStrict: false,
        revocations: [],
      };
    });
    render(<PrivateAccountSettings account={f.account} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review strict mode" }),
    );
    const strict = screen.getByRole("button", { name: "Enable strict mode" });
    expect(strict).toBeDisabled();
    expect(
      screen.getByText(/Earlier content can remain readable/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(strict);
    expect(
      await screen.findByText(/Strict mode is pending in 1 recovery target\./),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Finish strict mode on this device",
      }),
    ).not.toBeInTheDocument();
    expect(f.account.lock).not.toHaveBeenCalled();
  });
  it("status completion alone does not delete R; finishing is explicit", async () => {
    const f = service({
      mode: "strict",
      version: 2,
      unlocked: false,
      strictComplete: true,
      pending: [],
      accountKeyKept: true,
    });
    vi.mocked(f.account.enableStrict).mockResolvedValueOnce({
      version: 2,
      complete: true,
      pending: [],
      accountKeyKept: false,
      alreadyStrict: true,
      revocations: [],
    });
    render(<PrivateAccountSettings account={f.account} />);
    const finish = await screen.findByRole("button", {
      name: "Finish strict mode on this device",
    });
    expect(f.account.enableStrict).not.toHaveBeenCalled();
    fireEvent.click(finish);
    expect(
      await screen.findByText(/The recovery key was removed from this device/),
    ).toBeVisible();
    expect(f.account.enableStrict).toHaveBeenCalledOnce();
  });
  it("uses safe typed error copy and clears secret inputs after failure", async () => {
    const f = service({ mode: "password", version: 1, unlocked: false });
    vi.mocked(f.account.unlock).mockRejectedValueOnce({
      code: "wrong_secret",
      message: "secret password token",
    });
    render(<PrivateAccountSettings account={f.account} />);
    await screen.findByText("Locked on this device");
    fireEvent.change(screen.getByLabelText("Recovery password"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock private collections" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check it and try again",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "secret password token",
    );
    expect(screen.getByLabelText("Recovery password")).toHaveValue("");
  });
  it("aborts old facade work and never renders a late recovery key into a new account", async () => {
    const old = service(),
      next = service();
    let finish!: (r: { recoveryKey: string }) => void;
    vi.mocked(old.account.setup).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<PrivateAccountSettings account={old.account} />);
    await screen.findByRole("button", { name: "Set up recovery" });
    fillNewPassword();
    fireEvent.click(screen.getByRole("button", { name: "Set up recovery" }));
    const signal = vi.mocked(old.account.setup).mock.calls[0]![1]!;
    view.rerender(<PrivateAccountSettings account={next.account} />);
    expect(signal.aborted).toBe(true);
    finish({ recoveryKey: "OLD-ACCOUNT-SECRET" });
    await screen.findByRole("button", { name: "Set up recovery" });
    expect(
      screen.queryByDisplayValue("OLD-ACCOUNT-SECRET"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("New recovery password")).toHaveValue("");
  });
  it("recovers a failed status read without double fetch or hidden mutations", async () => {
    const f = service();
    vi.mocked(f.account.status).mockRejectedValueOnce(
      new Error("DO-NOT-ECHO-BEARER"),
    );
    render(<PrivateAccountSettings account={f.account} />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "DO-NOT-ECHO-BEARER",
    );
    expect(screen.getByText("Recovery status unavailable")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Check account status" }),
    );
    await screen.findByText("Recovery is not set up");
    expect(f.account.status).toHaveBeenCalledTimes(2);
    expect(f.account.setup).not.toHaveBeenCalled();
    expect(f.account.enableStrict).not.toHaveBeenCalled();
  });
  it("locks only on explicit request and clears the UI draft", async () => {
    const f = service({ mode: "password", version: 1, unlocked: true });
    render(<PrivateAccountSettings account={f.account} />);
    const lock = await screen.findByRole("button", {
      name: "Lock recovery key on this device",
    });
    fireEvent.change(screen.getByLabelText("Recovery password"), {
      target: { value: PASSWORD },
    });
    expect(f.account.lock).not.toHaveBeenCalled();
    fireEvent.click(lock);
    await screen.findByText("Locked on this device");
    expect(f.account.lock).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Recovery password")).toHaveValue("");
    expect(
      screen.getByText(/Existing collection keys remain available/),
    ).toBeVisible();
  });
  it("does not turn absent strict custody observations into a missing-key claim", async () => {
    const f = service({ mode: "strict", version: 2, unlocked: false });
    render(<PrivateAccountSettings account={f.account} />);
    expect(
      await screen.findByText(/Recovery key custody could not be checked/),
    ).toBeVisible();
    expect(
      screen.queryByText(/No recovery key is held/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Unknown recovery targets pending/)).toBeVisible();
    expect(f.account.enableStrict).not.toHaveBeenCalled();
  });
  it("works under StrictMode effect replay and suppresses double dispatch", async () => {
    const f = service();
    let finish!: (r: { recoveryKey: string }) => void;
    vi.mocked(f.account.setup).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <StrictMode>
        <PrivateAccountSettings account={f.account} />
      </StrictMode>,
    );
    const button = await screen.findByRole("button", {
      name: "Set up recovery",
    });
    fillNewPassword();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(f.account.setup).toHaveBeenCalledOnce();
    expect(vi.mocked(f.account.setup).mock.calls[0]![1]!.aborted).toBe(false);
    finish({ recoveryKey: RECOVERY });
    await screen.findByDisplayValue(RECOVERY);
  });
});

it("runs the setup screen on the real SDK facade with injected test-only custody/KDF ports", async () => {
  let row: { mode: string; version: number; key_id?: string; bundle?: string } =
    { mode: "none", version: 0 };
  const control: AccountKeyControlPort = {
    accountId: "00000000-0000-4000-8000-000000000001",
    status: async () => row,
    fetch: async () => row,
    put: async (body) => {
      row = {
        mode: "password",
        version: body.expected_version + 1,
        key_id: body.key_id,
        bundle: body.bundle,
      };
      return row;
    },
    strict: async () => {
      throw new Error("not used");
    },
    challenge: async () => {
      throw new Error("not used");
    },
    enrolRecoveryDevice: async () => {
      throw new Error("not used");
    },
  };
  const account = new PrivateAccount({
    control,
    secrets: memorySecretStore(),
    replica: {
      privateCollections: async () => [],
      keyAccountKeyDevice: async () => {},
      selfGrantWithAccountKey: async () => {},
    },
    argon2id: async (pw, salt) =>
      new Uint8Array(32).map(
        (_, i) => pw[i % pw.length]! ^ salt[i % salt.length]!,
      ),
    entropy: (n) => new Uint8Array(n).fill(7),
  });
  render(<PrivateAccountSettings account={account} />);
  await screen.findByRole("button", { name: "Set up recovery" });
  fillNewPassword();
  fireEvent.click(screen.getByRole("button", { name: "Set up recovery" }));
  const key = await screen.findByLabelText("Recovery key (shown once)");
  expect((key as HTMLTextAreaElement).value).toMatch(/^MDB1-/);
  expect(await account.status()).toMatchObject({
    mode: "password",
    unlocked: true,
    version: 1,
  });
});
