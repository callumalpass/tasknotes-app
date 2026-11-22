import { Capacitor } from "@capacitor/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { TaskRepository } from "../application/ports/task-repository";
import type { DirectBrowserGrant } from "@tasknotes/direct-sdk/direct";
import { directBrowserGrant } from "../storage/direct-browser-grant";
import { tabTaskEdits } from "./task-edit-recovery";
import { writeClipboard } from "../native/clipboard";
import { tasknotesMarkUrl } from "./assets";
import {
  backendHost,
  confirmPairInvitation,
  onPairInvitation,
  serverDescriptor,
} from "./direct-invitation";
import { clearDirectCollectionState, directSiteAvailable } from "./direct-site";
import { OpenedCollection } from "./opened-collection";
import "./direct-collection-gate.css";

type PairIssue = "address" | "code" | "unsent" | "unavailable" | "revoked";
type State =
  | { phase: "checking" | "blocked" | "invalid" | "busy" | "storage" }
  | { phase: "invited" | "changed" | "unsupported"; server: string }
  | { phase: "pair"; issue?: PairIssue }
  | { phase: "paired"; offline: boolean; server: string }
  | { phase: "open"; repository: TaskRepository };

function refused(reason: unknown) {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    reason.code === "unauthenticated"
  );
}

function hasReason(error: unknown, reason: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    error.reason === reason
  );
}

function unsupported(server: string) {
  return server.includes("#sha256=")
    ? typeof globalThis.WebTransport !== "function" ||
        typeof globalThis.WebTransport.prototype.createBidirectionalStream !==
          "function"
    : typeof globalThis.WebSocket !== "function";
}

export function DirectCollectionGate({
  open,
  pair,
  invitation,
  invalidEntry = false,
}: {
  invitation?: string;
  invalidEntry?: boolean;
  pair(options: {
    server: string;
    code: string;
    signal: AbortSignal;
  }): Promise<string>;
  open(
    server: string,
    token: string,
    signal: AbortSignal,
    disconnected: (reason: unknown, tasks?: string[]) => void,
  ): Promise<TaskRepository>;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<State>({ phase: "checking" });
  const requested = useRef(invitation);
  const [address, setAddress] = useState(invitation ?? "");
  const [manual, setManual] = useState(!invitation);
  const [remember, setRemember] = useState(false);
  const [tasks, setTasks] = useState<string[]>();
  const [tabEdits] = useState(tabTaskEdits);
  const [draftCleanupFailed, setDraftCleanupFailed] = useState(false);
  const [lostWorkspace, setLostWorkspace] = useState(false);
  const draft = useRef("");
  const [recoveryDraft, setRecoveryDraft] = useState("");
  const keepDraft = useCallback((fields: Record<string, unknown>) => {
    const { title, body, ...properties } = fields;
    draft.current =
      [
        title,
        body,
        Object.keys(properties).length
          ? JSON.stringify(properties, null, 2)
          : undefined,
      ]
        .filter((value) => typeof value === "string")
        .join("\n\n") ||
      (Object.keys(fields).length ? JSON.stringify(fields, null, 2) : "");
  }, []);
  const [rememberFailed, setRememberFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const grant = useRef<DirectBrowserGrant | undefined>(undefined);
  const [grantKind, setGrantKind] = useState<"saved" | "tab">();
  const rememberGrant = useCallback((value?: DirectBrowserGrant) => {
    grant.current = value;
    setGrantKind(value ? (value.receipt ? "saved" : "tab") : undefined);
  }, []);
  const clearDrafts = useCallback(
    (server: string) => {
      tabEdits.clear();
      setDraftCleanupFailed(!clearDirectCollectionState(server));
    },
    [tabEdits],
  );
  // A tab-only pairing ends with its tab, so nothing it kept may outlive it.
  useEffect(() => {
    if (grantKind !== "tab") return;
    const leave = () => {
      if (grant.current) clearDirectCollectionState(grant.current.server);
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [grantKind]);
  const attempt = useRef<AbortController | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const recoveryText = useRef<HTMLTextAreaElement>(null);
  const begin = useCallback(() => {
    attempt.current?.abort();
    const current = new AbortController();
    attempt.current = current;
    return current.signal;
  }, []);

  const allowed = useCallback(
    async (signal: AbortSignal) => {
      const available = await directSiteAvailable();
      if (signal.aborted) return false;
      if (!available) {
        attempt.current?.abort();
        rememberGrant();
        setState({ phase: "blocked" });
      }
      return available;
    },
    [rememberGrant],
  );

  let descriptor = "";
  try {
    descriptor = serverDescriptor(address);
  } catch {
    /* Editable, incomplete address. */
  }
  const incompatible = !!descriptor && unsupported(descriptor);
  const issue = state.phase === "pair" ? state.issue : undefined;
  useEffect(() => {
    if (state.phase === "pair" && !incompatible)
      (manual && (!issue || issue === "address")
        ? addressInput.current
        : codeInput.current
      )?.focus();
    else heading.current?.focus();
  }, [state.phase, issue, manual, incompatible]);

  const connect = useCallback(
    async (credential: DirectBrowserGrant, signal: AbortSignal) => {
      if (!(await allowed(signal))) return;
      rememberGrant(credential);
      const server = credential.server;
      if (unsupported(server)) {
        setState({ phase: "unsupported", server });
        return;
      }
      setAddress(server);
      setManual(false);
      setState({ phase: "busy" });
      let opened = false;
      const disconnected = async (reason: unknown, titles?: string[]) => {
        if (signal.aborted) return;
        const closing = begin();
        if (opened) {
          setLostWorkspace(true);
          setRecoveryDraft(draft.current);
          setTasks(titles);
          setCopied(false);
        }
        if (hasReason(reason, "browser_unsupported")) {
          setState({ phase: "unsupported", server });
          return;
        }
        if (!refused(reason)) {
          setState({ phase: "paired", offline: true, server });
          return;
        }
        setState({ phase: "busy" });
        try {
          if (!(await allowed(closing))) return;
          clearDrafts(server);
          if (credential.receipt) {
            await directBrowserGrant.forget(credential.receipt);
          }
          if (closing.aborted) return;
          rememberGrant();
          setRememberFailed(false);
          setState({ phase: "pair", issue: "revoked" });
        } catch {
          if (!closing.aborted) setState({ phase: "storage" });
        }
      };
      try {
        const repository = await open(
          server,
          credential.token,
          signal,
          (reason, titles) => void disconnected(reason, titles),
        );
        if (signal.aborted) repository.dispose?.();
        else {
          opened = true;
          setLostWorkspace(false);
          setRecoveryDraft("");
          setTasks(undefined);
          setState({ phase: "open", repository });
        }
      } catch (reason) {
        await disconnected(reason);
      }
    },
    [allowed, begin, clearDrafts, open, rememberGrant],
  );

  useEffect(() => {
    if (state.phase === "open" || !recoveryDraft) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.phase, recoveryDraft]);

  const readPairing = useCallback(
    async (
      signal: AbortSignal,
      request: {
        invitation?: string;
        expected?: DirectBrowserGrant;
        review?: boolean;
      },
    ) => {
      if (!(await allowed(signal))) return;
      try {
        const saved = await directBrowserGrant.read();
        if (signal.aborted) return;
        rememberGrant(saved);
        if (!saved) {
          setState({
            phase: "pair",
            issue: request.expected ? "revoked" : undefined,
          });
        } else if (request.invitation && saved.server !== request.invitation) {
          setState({ phase: "invited", server: saved.server });
        } else if (
          request.review ||
          (request.expected &&
            (saved.receipt !== request.expected.receipt ||
              saved.server !== request.expected.server))
        ) {
          setState({ phase: "changed", server: saved.server });
        } else await connect(saved, signal);
      } catch {
        if (!signal.aborted) setState({ phase: "storage" });
      }
    },
    [allowed, connect, rememberGrant],
  );

  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    const signal = begin();
    const block = () => {
      attempt.current?.abort();
      rememberGrant();
      setState({ phase: "blocked" });
    };
    const start = async () => {
      if (invalidEntry) {
        setState({ phase: "invalid" });
        return;
      }
      if (native) {
        block();
        return;
      }
      await readPairing(signal, { invitation });
    };
    navigator.serviceWorker?.addEventListener("controllerchange", block);
    void start().catch(() => {
      if (!signal.aborted) block();
    });
    return () => {
      attempt.current?.abort();
      navigator.serviceWorker?.removeEventListener("controllerchange", block);
    };
  }, [begin, invalidEntry, invitation, native, readPairing, rememberGrant]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.phase !== "pair" || !codeInput.current) return;
    const code = codeInput.current.value;
    if (!descriptor) {
      setState({ phase: "pair", issue: "address" });
      addressInput.current?.focus();
      return;
    }
    if (incompatible) return;
    codeInput.current.value = "";
    if (!/^[0-9]{8}$/u.test(code)) {
      setState({ phase: "pair", issue: "code" });
      codeInput.current.focus();
      return;
    }
    const signal = begin();
    setState({ phase: "busy" });
    try {
      if (!(await allowed(signal))) return;
      setRememberFailed(false);
      let credential: DirectBrowserGrant = {
        server: descriptor,
        token: await pair({ server: descriptor, code, signal }),
      };
      if (signal.aborted) return;
      if (remember) {
        if (!(await allowed(signal))) return;
        try {
          credential = {
            ...credential,
            receipt: await directBrowserGrant.save(credential),
          };
        } catch {
          if (signal.aborted) return;
          setRememberFailed(true);
        }
      }
      if (!signal.aborted) await connect(credential, signal);
    } catch (reason) {
      if (signal.aborted) return;
      if (hasReason(reason, "browser_unsupported"))
        setState({ phase: "unsupported", server: descriptor });
      else
        setState({
          phase: "pair",
          issue: refused(reason)
            ? "code"
            : hasReason(reason, "code_not_sent")
              ? "unsent"
              : "unavailable",
        });
    }
  };
  const reconnect = async () => {
    const expected = grant.current;
    if (!expected) return;
    const signal = begin();
    if (!expected.receipt) return connect(expected, signal);
    setState({ phase: "busy" });
    await readPairing(signal, { expected });
  };
  const receiveInvitation = useEffectEvent((next?: string) => {
    // A hash navigation must never bypass the initial origin and storage checks.
    if (
      state.phase === "blocked" ||
      state.phase === "storage" ||
      state.phase === "checking" ||
      state.phase === "busy" ||
      state.phase === "invalid"
    )
      return;
    if (!next) {
      if (state.phase === "pair") {
        setAddress("");
        setManual(true);
        if (codeInput.current) codeInput.current.value = "";
        setState({ phase: "pair", issue: "address" });
      }
      return;
    }
    const active = grant.current;
    if (active?.server === next) {
      if (state.phase !== "open") void reconnect();
      return;
    }
    if (active && !confirmPairInvitation(next)) return;
    requested.current = next;
    begin();
    if (codeInput.current) codeInput.current.value = "";
    setAddress(next);
    setManual(false);
    setRecoveryDraft(draft.current);
    setState(
      active ? { phase: "invited", server: active.server } : { phase: "pair" },
    );
  });
  useEffect(() => onPairInvitation(receiveInvitation), []);

  const forget = async () => {
    if (
      !window.confirm(
        grantKind === "tab"
          ? t`Disconnect this tab? Copy unsaved edits first. You will need a new code to pair again.`
          : t`Forget this browser’s pairing? Copy any unsaved edits first. To revoke access, remove this browser on your server.`,
      )
    )
      return;
    const signal = begin();
    const credential = grant.current;
    const receipt = credential?.receipt;
    setState({ phase: "busy" });
    try {
      if (!(await allowed(signal))) return;
      if (receipt) await directBrowserGrant.forget(receipt);
      if (signal.aborted) return;
      if (credential) clearDrafts(credential.server);
      rememberGrant();
      draft.current = "";
      setRecoveryDraft("");
      setRememberFailed(false);
      setLostWorkspace(false);
      setTasks(undefined);
      history.replaceState(null, "", "/");
      setAddress(requested.current ?? "");
      setManual(!requested.current);
      setState({ phase: "pair" });
    } catch {
      if (!signal.aborted) setState({ phase: "storage" });
    }
  };
  const manage = () => {
    if (
      !window.confirm(
        t`Close this collection? Copy unsaved work first. Pending deletions will be cancelled if they have not started.`,
      )
    )
      return;
    begin();
    setRecoveryDraft(draft.current);
    setState({ phase: "paired", offline: false, server: address });
  };
  const tabNotice = rememberFailed && (
    <aside className="direct-tab-notice" role="status">
      <Trans>
        Paired for this tab only. The connection could not be remembered.
      </Trans>
      <button
        className="text-action"
        type="button"
        onClick={() => setRememberFailed(false)}
      >
        <Trans>Dismiss</Trans>
      </button>
    </aside>
  );
  if (state.phase === "open")
    return (
      <>
        {tabNotice}
        <OpenedCollection
          actions={{
            collectionUi: null,
            changeCollection: manage,
            reauthorizeCurrentCollection: manage,
            taskEditStorage: grantKind === "tab" ? tabEdits : undefined,
            onTaskDraft: keepDraft,
          }}
          repository={state.repository}
        />
      </>
    );

  const selectedServer =
    state.phase === "unsupported" ? state.server : descriptor;
  const transport = selectedServer?.includes("#sha256=")
    ? "WebTransport"
    : "WebSocket";
  const unsupportedMessage = (
    <p role="alert">
      <Trans>
        This browser cannot connect to this server. Open the same link in a
        browser with {transport} support.
      </Trans>
    </p>
  );
  return (
    <main className="opening-screen direct-collection-screen">
      <img alt="" src={tasknotesMarkUrl} />
      <h1 ref={heading} tabIndex={-1}>
        <Trans>Connect to your own server</Trans>
      </h1>
      {tabNotice}
      {draftCleanupFailed && (
        <p role="alert">
          <Trans>
            Browser storage is unavailable. Clear this site’s data on this
            device to remove saved drafts.
          </Trans>
        </p>
      )}
      {state.phase === "blocked" && (
        <p role="alert">
          <Trans>
            Open this build on an HTTPS site without a service worker.
          </Trans>
        </p>
      )}
      {state.phase === "invalid" && (
        <p role="alert">
          <Trans>
            This invitation is invalid. Open the original link from your server.
          </Trans>
        </p>
      )}
      {state.phase === "unsupported" && unsupportedMessage}
      {(state.phase === "busy" || state.phase === "checking") && (
        <p role="status">
          <Trans>Connecting…</Trans>
        </p>
      )}
      {lostWorkspace && (
        <div role="alert">
          <p>
            {tasks
              ? t`Connection lost. A change in progress may have reached your server. Reconnect and check before trying again.`
              : t`Connection lost. Reconnect to your server.`}{" "}
            {tasks?.join(", ")}
          </p>
          <p>
            <Trans>Deletions still in the Undo window were cancelled.</Trans>
          </p>
        </div>
      )}
      {recoveryDraft && (
        <div className="direct-collection-form">
          <label htmlFor="direct-draft">
            <Trans>Unsaved task edits</Trans>
          </label>
          <textarea
            id="direct-draft"
            ref={recoveryText}
            value={recoveryDraft}
            readOnly
          />
          <button
            type="button"
            className="outline-action"
            onClick={async () => {
              try {
                await writeClipboard(recoveryDraft);
                setCopied(true);
              } catch {
                recoveryText.current?.focus();
                recoveryText.current?.select();
              }
            }}
          >
            {copied ? t`Copied` : t`Copy unsaved edits`}
          </button>
        </div>
      )}
      {state.phase === "pair" && (
        <form
          noValidate
          className="direct-collection-form"
          onSubmit={(event) => void submit(event)}
        >
          <p>
            <Trans>
              Online only. Your pairing code lets this app read and change the
              collection on your server.
            </Trans>
          </p>
          {manual && (
            <>
              <label htmlFor="direct-server">
                <Trans>Invitation link or HTTPS server address</Trans>
              </label>
              <input
                ref={addressInput}
                id="direct-server"
                type="url"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={address}
                aria-invalid={issue === "address"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (issue) setState({ phase: "pair" });
                  setAddress(value);
                  if (value.includes("#mdbase-pair=")) {
                    try {
                      setAddress(serverDescriptor(value));
                      setManual(false);
                    } catch {
                      setState({ phase: "pair", issue: "address" });
                    }
                  }
                  if (
                    codeInput.current &&
                    (descriptor || value.includes("#mdbase-pair"))
                  )
                    codeInput.current.value = "";
                }}
              />
            </>
          )}
          {descriptor && (
            <p>
              <Trans>
                Pair with <strong>{backendHost(descriptor)}</strong>
              </Trans>
            </p>
          )}
          {issue === "address" && (
            <p role="alert">
              <Trans>
                Paste an invitation for this app site or a valid HTTPS server
                address.
              </Trans>
            </p>
          )}
          {incompatible ? (
            unsupportedMessage
          ) : (
            <>
              <label htmlFor="direct-code">
                <Trans>8-digit pairing code from your server</Trans>
              </label>
              <input
                ref={codeInput}
                id="direct-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{8}"
                maxLength={8}
                autoComplete="one-time-code"
                required
              />
              {issue === "code" && (
                <p role="alert">
                  <Trans>
                    That code is incorrect or expired. Check all eight digits or
                    ask for a new code.
                  </Trans>
                </p>
              )}
              {(issue === "unavailable" || issue === "unsent") && (
                <p role="alert">
                  {issue === "unsent" ? (
                    <Trans>
                      The server was not reached, so your code was not used.
                      Check the server and network, then enter the code again.
                    </Trans>
                  ) : (
                    <Trans>
                      Pairing could not be confirmed. Check your network and
                      server, then check whether the browser was paired before
                      requesting another code.
                    </Trans>
                  )}
                  {descriptor.includes("#sha256=") && (
                    <>
                      {" "}
                      <Trans>
                        If your browser asked, allow local-network access for
                        this site.
                      </Trans>
                    </>
                  )}
                </p>
              )}
              {issue === "revoked" && (
                <p role="alert">
                  <Trans>
                    This pairing is no longer accepted. Ask for a new code.
                  </Trans>
                </p>
              )}
              <label className="direct-remember">
                <input
                  type="checkbox"
                  id="direct-remember"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <Trans>Remember this browser</Trans>
              </label>
              <small>
                <Trans>
                  On a shared device, leave this unchecked. The pairing and
                  unsaved task edits last only in this tab. Remembering also
                  saves unsaved task edits in this browser.
                </Trans>
              </small>
              <button type="submit" className="outline-action">
                <Trans>Pair and open collection</Trans>
              </button>
            </>
          )}
          {!manual && (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setManual(true);
                setAddress("");
                if (codeInput.current) codeInput.current.value = "";
              }}
            >
              <Trans>Use another server address</Trans>
            </button>
          )}
        </form>
      )}
      {(state.phase === "changed" ||
        state.phase === "invited" ||
        state.phase === "paired" ||
        state.phase === "storage" ||
        state.phase === "unsupported") && (
        <div className="direct-collection-form">
          {(state.phase === "changed" ||
            state.phase === "invited" ||
            state.phase === "paired") && (
            <>
              {state.phase === "changed" && (
                <p role="alert">
                  <Trans>
                    The saved pairing changed. Check the server below before
                    reconnecting.
                  </Trans>
                </p>
              )}
              {state.phase === "invited" && (
                <p>
                  <Trans>
                    Invitation from <strong>{backendHost(address)}</strong>.
                    Reconnect to your saved server or forget it to use the
                    invitation.
                  </Trans>
                </p>
              )}
              <p>{backendHost(state.server)}</p>
              {state.phase === "paired" && state.offline && !lostWorkspace && (
                <p role="alert">
                  <Trans>
                    Server unavailable. Check your network and reconnect with
                    the same pairing.
                  </Trans>
                </p>
              )}
              <button
                type="button"
                className="outline-action"
                onClick={() => {
                  void reconnect();
                }}
              >
                <Trans>Reconnect</Trans>
              </button>
            </>
          )}
          {state.phase === "storage" ? (
            <>
              <p role="alert">
                <Trans>
                  Browser pairing storage is unavailable. Check this site’s
                  storage settings and try again.
                </Trans>
              </p>
              <button
                type="button"
                className="outline-action"
                onClick={() => {
                  setState({ phase: "busy" });
                  void readPairing(begin(), {
                    invitation: requested.current,
                    review: true,
                  });
                }}
              >
                <Trans>Try again</Trans>
              </button>
            </>
          ) : grantKind ? (
            <button
              type="button"
              className="text-action"
              onClick={() => void forget()}
            >
              {grantKind === "saved" ? t`Forget this browser` : t`Disconnect`}
            </button>
          ) : null}
        </div>
      )}
      <footer>
        <p>
          <Trans>Most people use TaskNotes with mdbase.</Trans>
        </p>
        <a href="https://app.tasknotes.dev/" rel="noreferrer">
          <Trans>Return to TaskNotes</Trans>
        </a>
      </footer>
    </main>
  );
}
