import type {
  AppLockPort,
  AppWebNativeCollection,
  AppWebSignInSession,
} from "@mdbase-dev/sdk/app-host";
import { requireTaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  installationErrorCode,
} from "./next-installation-protocol";
import { createTaskNotesWebSignInSession } from "./next-web-sign-in-session";
import {
  isNextWebSignInRequest,
  type NextWebSignInMessage,
  type NextWebSignInRequest,
} from "./next-web-sign-in-protocol";

interface OwnerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: NextWebSignInMessage, transfer?: Transferable[]): void;
}

/** Worker transport composition only. SDK session owns polling, HOST and leases;
 * its factory owns SQL/native/drive/journal. No model mutation RPC or 30s timer.
 * Failed close retains this original owner; never terminate it to fake cleanup.
 */
export function attachTaskNotesWebSignInOwner(
  port: OwnerPort,
  origin: string,
  locks: AppLockPort | undefined,
): void {
  const lifetime = new AbortController();
  let session: AppWebSignInSession<AppWebNativeCollection> | null = null;
  let opened = false,
    busy = false,
    lastId = 0;
  let stopSnapshot: (() => void) | null = null;
  const send = (message: NextWebSignInMessage, transfer?: Transferable[]) =>
    port.postMessage(message, transfer);
  async function dispatch(request: NextWebSignInRequest) {
    const command = request.command;
    if (command.kind === "open") {
      if (opened || lifetime.signal.aborted) throw Error("closed");
      opened = true;
      const build = command.build;
      requireTaskNotesAppEnvironment(
        build.environment,
        build.environment === "lab" ? build.appOrigin : undefined,
        origin,
      );
      if (!(build.runtime instanceof Uint8Array) || !build.runtime.byteLength ||
        build.runtime.byteLength > NATIVE_WASM_MAX_BYTES ||
        !/^[0-9a-f]{64}$/.test(build.runtimeSha256)) throw Error("artifact binding");
      const runtime = new Uint8Array(build.runtime);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", runtime));
      lifetime.signal.throwIfAborted();
      const actual = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
      if (actual !== build.runtimeSha256) throw Error("artifact binding");
      session = createTaskNotesWebSignInSession({
        build: { ...build, runtime }, signal: lifetime.signal, locks,
        ...(command.requestedCreateCollections === undefined ? {} : {
          requestedCreateCollections: command.requestedCreateCollections,
        }),
        openPortal: () => ({
          navigate: uri => send({ schema: "tasknotes-web-sign-in-portal/1", action: "navigate", uri }),
          close: () => send({ schema: "tasknotes-web-sign-in-portal/1", action: "close" }),
        }),
        handoff: handoff => send({ schema: "tasknotes-web-sign-in-handoff/1", handoff },
          [handoff.dataPort, handoff.controlPort]),
      });
      stopSnapshot = session.subscribe(() => send({
        schema: "tasknotes-web-sign-in-snapshot/1", snapshot: session!.snapshot(),
      }));
      return session.snapshot();
    }
    if (!session || lifetime.signal.aborted) throw Error("closed");
    switch (command.kind) {
      case "start": return session.start();
      case "authorize": return session.authorize();
      case "renew-expired": return session.renewExpiredPairing();
      case "select": return session.select(command.collectionId);
      case "clear-selection": return session.clearSelection();
      case "set-foreground":
        session.setForeground(command.active);
        session.connection()?.setForeground(command.active);
        return session.snapshot();
      case "close":
        // Abort is internal to the public session; wait for native/SQL/lease
        // stop. A failed close keeps the same session/observer here quarantined.
        await session.close();
        stopSnapshot?.(); stopSnapshot = null;
        lifetime.abort();
        session = null;
        return null;
    }
  }
  port.onmessage = event => {
    if (!isNextWebSignInRequest(event.data) || event.data.id <= lastId) {
      lifetime.abort(); // SDK closes its original owner; never force termination.
      return;
    }
    const request = event.data;
    lastId = request.id;
    // Foreground is a synchronous public SDK hint, not a queued journal action.
    if (request.command.kind === "set-foreground" && session && !lifetime.signal.aborted) {
      session.setForeground(request.command.active);
      session.connection()?.setForeground(request.command.active);
      send({ schema: "tasknotes-web-sign-in-reply/1", id: request.id, ok: true, snapshot: session.snapshot() });
      return;
    }
    if (busy) {
      send({ schema: "tasknotes-web-sign-in-reply/1", id: request.id, ok: false, reason: "busy" });
      return;
    }
    busy = true;
    void dispatch(request).then(
      snapshot => send({ schema: "tasknotes-web-sign-in-reply/1", id: request.id, ok: true, snapshot }),
      error => send({ schema: "tasknotes-web-sign-in-reply/1", id: request.id, ok: false, reason: installationErrorCode(error) }),
    ).finally(() => { busy = false; });
  };
}
