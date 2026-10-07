import { useEffect, useRef, useState, type FormEvent } from "react";
import "./private-account-settings.css";
import type {
  PrivateAccount,
  PrivateAccountStatus,
} from "@mdbase-dev/sdk/account";

/** The authenticated host injects the SDK facade. No UI-owned key store, bearer,
 * device signer, or RAM/keychain fallback; legacy/demo hosts omit this surface. */
export type PrivateAccountUi = Pick<
  PrivateAccount,
  | "status"
  | "passwordStrength"
  | "setup"
  | "unlock"
  | "recover"
  | "changePassword"
  | "enableStrict"
  | "lock"
>;
const scopes = new WeakMap<PrivateAccountUi, number>();
let nextScope = 0;

/** Remount on account-facade changes so old passwords/recovery text never render
 * in a new account, even for one frame before effect cleanup. */
export function PrivateAccountSettings({
  account,
}: {
  account: PrivateAccountUi;
}) {
  let scope = scopes.get(account);
  if (scope === undefined) {
    scope = ++nextScope;
    scopes.set(account, scope);
  }
  return <PrivateAccountPanel key={scope} account={account} />;
}

type Action = "setup" | "unlock" | "recover" | "change_password";
const labels: Record<Action, string> = {
  setup: "Set up recovery",
  unlock: "Unlock private collections",
  recover: "Recover account access",
  change_password: "Change recovery password",
};

function problemCopy(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "wrong_secret":
    case "invalid_recovery_key":
      return "That password or recovery key did not unlock this account. Check it and try again.";
    case "weak_password":
      return "Use a longer, less predictable passphrase.";
    case "rate_limited":
      return "Too many attempts. Wait before trying again.";
    case "conflict":
      return "Account recovery changed on another device. Check its status before trying again.";
    case "strict_mode":
      return "This account uses strict mode. Approve this device from an existing device.";
    default:
      // Never echo foreign exception text, passwords, recovery keys or tokens.
      return "The account recovery action could not be completed. Check the connection and account status before retrying.";
  }
}

function PrivateAccountPanel({ account }: { account: PrivateAccountUi }) {
  const [status, setStatus] = useState<PrivateAccountStatus | null>(null);
  const [action, setAction] = useState<Action>("unlock");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [shownRecoveryKey, setShownRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [strictReview, setStrictReview] = useState(false);
  const [strictUnderstood, setStrictUnderstood] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const working = useRef(false);

  useEffect(() => {
    const scope = new AbortController();
    lifetime.current = scope;
    void account.status({ signal: scope.signal }).then(
      (next) => {
        if (scope.signal.aborted) return;
        setStatus(next);
        setAction(next.mode === "none" ? "setup" : "unlock");
      },
      () => {
        if (!scope.signal.aborted)
          setProblem(
            "Could not check account recovery. Check the connection and try again.",
          );
      },
    );
    return () => {
      scope.abort();
    };
  }, [account]);

  async function perform(
    operation: (signal: AbortSignal) => Promise<void>,
    refreshAfter = true,
  ) {
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted || working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    // JS strings cannot be securely wiped; retain no form draft after dispatch.
    setPassword("");
    setConfirmation("");
    setRecoveryInput("");
    try {
      await operation(scope.signal);
      if (scope.signal.aborted) return;
      if (!refreshAfter) return;
      try {
        const next = await account.status({ signal: scope.signal });
        if (!scope.signal.aborted) setStatus(next);
      } catch {
        if (!scope.signal.aborted)
          setProblem(
            "The action finished, but account status could not be refreshed. Check status again.",
          );
      }
    } catch (error) {
      if (!scope.signal.aborted) setProblem(problemCopy(error));
    } finally {
      working.current = false;
      if (!scope.signal.aborted) setBusy(false);
    }
  }

  async function checkStatus() {
    await perform(async (signal) => {
      const next = await account.status({ signal });
      if (signal.aborted) return;
      setStatus(next);
      setAction(next.mode === "none" ? "setup" : "unlock");
    }, false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status || !valid || shownRecoveryKey) return;
    const secret = password,
      recovery = recoveryInput;
    await perform(async (signal) => {
      if (action === "setup") {
        const result = await account.setup(secret, signal);
        if (signal.aborted) return;
        setShownRecoveryKey(result.recoveryKey);
        setAction("unlock");
        setNotice(
          result.incomplete?.length
            ? `Recovery is set up. ${result.incomplete.length} private collections still need to finish key access.`
            : "Recovery is set up. Save your recovery key before leaving this screen.",
        );
      } else if (action === "change_password") {
        await account.changePassword(secret, signal);
        if (!signal.aborted)
          setNotice(
            "Recovery password changed. Your recovery key is unchanged.",
          );
      } else {
        const result =
          action === "recover"
            ? await account.recover(recovery, secret, signal)
            : await account.unlock(
                recovery ? { recoveryKey: recovery } : { password: secret },
                signal,
              );
        if (signal.aborted) return;
        setNotice(
          result.incomplete?.length
            ? `Account unlocked. ${result.incomplete.length} private collections still need to finish key access; retry unlock when they are current.`
            : "Account unlocked. Private collection keys are available on this device.",
        );
      }
    });
  }
  async function strict() {
    if (
      !status ||
      shownRecoveryKey ||
      (status.mode !== "strict" && !strictUnderstood)
    )
      return;
    await perform(async (signal) => {
      const result = await account.enableStrict(signal);
      if (signal.aborted) return;
      setStrictReview(false);
      setStrictUnderstood(false);
      setNotice(
        result.complete
          ? "mdbase confirmed strict-mode completion. The recovery key was removed from this device."
          : `Strict mode is pending in ${result.pending.length} recovery ${result.pending.length === 1 ? "target" : "targets"}. The recovery key stays on this device until mdbase confirms completion.`,
      );
    });
  }

  const needsNewPassword = action !== "unlock";
  const strength = needsNewPassword ? account.passwordStrength(password) : null;
  const valid = needsNewPassword
    ? strength?.acceptable === true &&
      password === confirmation &&
      (action !== "recover" || recoveryInput.trim().length > 0)
    : password.length > 0 || recoveryInput.trim().length > 0;

  return (
    <section
      className="settings-section private-account-settings"
      aria-labelledby="private-account-title"
    >
      <h2 id="private-account-title">Private account recovery</h2>
      <div className="settings-content">
        <p className="section-copy">
          Your password unlocks private collections on approved devices. It is
          processed on this device, not sent to mdbase.
        </p>
        {!status ? (
          <p role="status">
            {problem
              ? "Recovery status unavailable"
              : "Checking account recovery…"}
          </p>
        ) : null}
        {status ? (
          <p role="status">
            {status.mode === "strict"
              ? "Strict mode"
              : status.mode === "none"
                ? "Recovery is not set up"
                : status.unlocked
                  ? "Unlocked on this device"
                  : "Locked on this device"}
          </p>
        ) : null}
        {shownRecoveryKey ? (
          <div className="private-recovery-key">
            <h3>Save your recovery key</h3>
            <p className="section-copy">
              This key is shown once. Keep it somewhere secure outside
              TaskNotes. Anyone with it can recover access to your private
              collections.
            </p>
            <label>
              Recovery key (shown once)
              <textarea
                readOnly
                autoComplete="off"
                spellCheck={false}
                value={shownRecoveryKey}
              />
            </label>
            <button
              className="text-action"
              type="button"
              onClick={() => {
                setShownRecoveryKey(null);
                setNotice(
                  "Recovery key dismissed. TaskNotes does not keep a display copy.",
                );
              }}
            >
              I saved my recovery key
            </button>
          </div>
        ) : status && status.mode !== "strict" ? (
          <>
            {status.mode === "password" ? (
              <div className="private-account-actions">
                <button
                  className="text-action"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAction("unlock");
                    setPassword("");
                    setConfirmation("");
                    setRecoveryInput("");
                  }}
                >
                  Unlock
                </button>
                <button
                  className="text-action"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAction("recover");
                    setPassword("");
                    setConfirmation("");
                    setRecoveryInput("");
                  }}
                >
                  Forgot password
                </button>
                {status.unlocked ? (
                  <button
                    className="text-action"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAction("change_password");
                      setPassword("");
                      setConfirmation("");
                      setRecoveryInput("");
                    }}
                  >
                    Change password
                  </button>
                ) : null}
              </div>
            ) : null}
            <form onSubmit={(event) => void submit(event)}>
              <fieldset disabled={busy}>
                <legend>{labels[action]}</legend>
                {action === "recover" || action === "unlock" ? (
                  <label>
                    Recovery key
                    {action === "unlock" ? " (or use your password)" : ""}
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={recoveryInput}
                      onChange={(event) => setRecoveryInput(event.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  {needsNewPassword
                    ? "New recovery password"
                    : "Recovery password"}
                  <input
                    type="password"
                    autoComplete={
                      needsNewPassword ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {needsNewPassword ? (
                  <>
                    <label>
                      Confirm new recovery password
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                      />
                    </label>
                    <p role="status">
                      Password strength: {strength!.score} of 4
                    </p>
                    {strength!.feedback.map((line) => (
                      <p className="section-copy" key={line}>
                        {line}
                      </p>
                    ))}
                  </>
                ) : null}
                <button className="text-action" disabled={!valid} type="submit">
                  {busy ? "Working…" : labels[action]}
                </button>
              </fieldset>
            </form>
            {status.mode === "password" && status.unlocked ? (
              <button
                className="text-action"
                type="button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await account.lock();
                    if (!lifetime.current?.signal.aborted)
                      setNotice(
                        "Recovery key locked on this device. Existing collection keys remain available.",
                      );
                  })
                }
              >
                Lock recovery key on this device
              </button>
            ) : null}
            {status.mode === "password" ? (
              <button
                className="text-action"
                type="button"
                disabled={busy}
                onClick={() => setStrictReview((shown) => !shown)}
              >
                Review strict mode
              </button>
            ) : null}
          </>
        ) : null}
        {strictReview && !shownRecoveryKey ? (
          <div>
            <h3>Switch to strict mode</h3>
            <p className="section-copy">
              New devices will need approval from an existing device. Password
              and recovery-key unlock will stop. Earlier content can remain
              readable to someone with the old password and bundle until
              collections apply the revocations and rekey.
            </p>
            <label className="private-account-consent">
              <input
                type="checkbox"
                checked={strictUnderstood}
                disabled={busy}
                onChange={(event) => setStrictUnderstood(event.target.checked)}
              />
              I understand that existing devices must finish applying strict
              mode.
            </label>
            <button
              className="text-action"
              type="button"
              disabled={busy || !strictUnderstood}
              onClick={() => void strict()}
            >
              Enable strict mode
            </button>
          </div>
        ) : null}
        {status?.mode === "strict" ? (
          <div>
            <p className="section-copy">
              {status.strictComplete === true
                ? "mdbase confirmed that recovery targets have applied strict mode."
                : "Strict mode is not yet confirmed across every private recovery target. An online keyed device must finish applying the changes."}
            </p>
            <p className="section-copy">
              {status.pending?.length ?? "Unknown"} recovery targets pending.{" "}
              {status.accountKeyKept === true
                ? "The recovery key is still kept on this device."
                : status.accountKeyKept === false
                  ? "No recovery key is held on this device."
                  : "Recovery key custody could not be checked."}
            </p>
            <button
              className="text-action"
              type="button"
              disabled={busy}
              onClick={() => void strict()}
            >
              {status.strictComplete === true && status.accountKeyKept
                ? "Finish strict mode on this device"
                : "Check strict completion"}
            </button>
          </div>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {problem ? (
          <p className="inline-error" role="alert">
            {problem}
          </p>
        ) : null}
        <button
          className="text-action"
          type="button"
          disabled={busy}
          onClick={() => void checkStatus()}
        >
          Check account status
        </button>
      </div>
    </section>
  );
}
