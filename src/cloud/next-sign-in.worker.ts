import { requireTaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  installationErrorCode,
  isNextInstallationCommand,
  type NextInstallationRequest,
  type NextInstallationResult,
  type NextInstallationResponse,
} from "./next-installation-protocol";
import { createNextSignInSession } from "./next-sign-in-session";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";

const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
const lifetime = new AbortController();
let owner: ReturnType<typeof createNextSignInSession> | null = null;
let opened = false,
  busy = false,
  lastId = 0;
let stopSnapshot: (() => void) | null = null;
let closing: Promise<void> | null = null;
const result = (snapshot: AppWebSignInSnapshot): NextInstallationResult => ({
  kind: "session",
  snapshot,
});
async function dispatch({
  command,
}: NextInstallationRequest): Promise<NextInstallationResult> {
  if (command.kind === "session-open") {
    if (opened || lifetime.signal.aborted)
      throw Object.assign(Error("closed"), { reason: "closed" });
    opened = true;
    const build = command.build;
    requireTaskNotesAppEnvironment(
      build.environment,
      build.environment === "lab" ? build.appOrigin : undefined,
      location.origin,
    );
    if (
      !(build.runtime instanceof Uint8Array) ||
      !build.runtime.length ||
      build.runtime.length > NATIVE_WASM_MAX_BYTES ||
      !/^[0-9a-f]{64}$/.test(build.runtimeSha256)
    )
      throw Object.assign(Error("artifact binding"), { reason: "binding" });
    const artifact = new Uint8Array(build.runtime);
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", artifact),
    );
    lifetime.signal.throwIfAborted();
    if (
      Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("") !==
      build.runtimeSha256
    )
      throw Object.assign(Error("artifact binding"), { reason: "binding" });
    owner = createNextSignInSession({
      build: { ...build, runtime: artifact },
      signal: lifetime.signal,
      locks: navigator.locks,
      openPortal: () => ({
        navigate: (uri) =>
          port.postMessage({ version: 1, event: "portal-navigate", uri }),
        close: () => port.postMessage({ version: 1, event: "portal-close" }),
      }),
    });
    stopSnapshot = owner.session.subscribe(() =>
      port.postMessage({
        version: 1,
        event: "session-snapshot",
        snapshot: owner!.session.snapshot(),
      }),
    );
    return result(owner.session.snapshot());
  }
  if (!owner || lifetime.signal.aborted || closing)
    throw Object.assign(Error("closed"), { reason: "closed" });
  switch (command.kind) {
    case "session-start":
      return result(await owner.session.start());
    case "session-authorize":
      return result(await owner.session.authorize());
    case "session-renew":
      return result(await owner.session.renewExpiredPairing());
    case "session-select":
      return result(await owner.session.select(command.collectionId));
    case "session-connection":
      return owner.takeConnection(command.collectionId);
    case "model-setup-intent":
    case "model-resource-setup-intent":
      return owner.journal(command);
    case "model-setup-verified":
      await owner.verified();
      return null;
    case "set-foreground":
      owner.foreground(command.active);
      return null;
    default:
      throw Object.assign(Error("unsupported command"), { reason: "binding" });
  }
}
function close() {
  if (closing) return closing;
  // Public close aborts before waiting and retains native/SQL/lease resources
  // on failure. Never terminate this Worker or construct a replacement owner.
  closing = Promise.resolve().then(async () => {
    await owner?.session.close();
    stopSnapshot?.();
    stopSnapshot = null;
    lifetime.abort();
  });
  void closing.then(
    () => port.postMessage({ version: 1, event: "session-closed", ok: true }),
    () => port.postMessage({ version: 1, event: "session-closed", ok: false }),
  );
  return closing;
}
port.onmessage = ({ data }) => {
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "event" in data &&
    data.event === "session-close" &&
    "version" in data &&
    data.version === 1 &&
    Object.keys(data).sort().join() === "event,version"
  ) {
    void close().catch(() => {});
    return;
  }
  const request = data as NextInstallationRequest;
  if (
    !request ||
    request.version !== 1 ||
    !Number.isInteger(request.id) ||
    request.id <= lastId ||
    request.id > 0xffffffff ||
    !isNextInstallationCommand(request.command)
  ) {
    void close().catch(() => {});
    return;
  }
  lastId = request.id;
  if (busy) {
    port.postMessage({ version: 1, id: request.id, ok: false, reason: "busy" });
    return;
  }
  busy = true;
  void dispatch(request)
    .then(
      (value) => {
        const response: NextInstallationResponse = {
          version: 1,
          id: request.id,
          ok: true,
          result: value,
        };
        if (
          value &&
          !Array.isArray(value) &&
          "kind" in value &&
          value.kind === "collection"
        )
          port.postMessage(response, [value.channel]);
        else port.postMessage(response);
      },
      (error) =>
        port.postMessage({
          version: 1,
          id: request.id,
          ok: false,
          reason: installationErrorCode(error),
        }),
    )
    .finally(() => {
      busy = false;
    });
};
