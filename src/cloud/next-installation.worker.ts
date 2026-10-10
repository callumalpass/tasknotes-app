import { requireTaskNotesAppEnvironment } from "./app-environment";
import { NextTaskNotesInstallation } from "./next-installation";
import {
  NATIVE_WASM_MAX_BYTES,
  installationErrorCode,
  isNextInstallationCommand,
  type NextInstallationRequest,
  type NextInstallationResponse,
  type NextInstallationResult,
} from "./next-installation-protocol";

const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<NextInstallationRequest>) => void) | null;
  postMessage(
    message: NextInstallationResponse,
    transfer?: Transferable[],
  ): void;
  close(): void;
};
let controller: NextTaskNotesInstallation | null = null;
const lifetime = new AbortController();
let busy = false,
  lastId = 0,
  opened = false;
async function dispatch(
  request: NextInstallationRequest,
): Promise<NextInstallationResult> {
  const command = request.command;
  if (command.kind === "open") {
    if (opened) throw Error("original worker already opened");
    opened = true; // Failed initialization cannot silently create a second actor.
    const { build } = command;
    requireTaskNotesAppEnvironment(
      build.environment,
      build.environment === "lab" ? build.appOrigin : undefined,
      globalThis.location.origin,
    );
    if (
      !(build.runtime instanceof Uint8Array) ||
      build.runtime.length === 0 ||
      build.runtime.length > NATIVE_WASM_MAX_BYTES ||
      !/^[0-9a-f]{64}$/.test(build.runtimeSha256)
    )
      throw Error("invalid artifact");
    const artifact = new Uint8Array(build.runtime);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", artifact),
    );
    const hex = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    digest.fill(0);
    if (hex !== build.runtimeSha256) {
      artifact.fill(0);
      throw Error("artifact digest mismatch");
    }
    // This hash check detects transport corruption. Prior independent BUILD
    // authentication of the release/context/artifact is still mandatory.
    controller = await NextTaskNotesInstallation.open({
      environment: build.environment,
      appOrigin: build.appOrigin,
      appId: build.appId,
      appName: build.appName,
      release: build.release,
      mode: command.mode,
      signal: lifetime.signal,
      locks: navigator.locks,
      ...(command.requestedCreateCollections === undefined
        ? {}
        : { requestedCreateCollections: command.requestedCreateCollections }),
      loadRuntime: async ({ signal }) => {
        signal.throwIfAborted();
        return new Uint8Array(artifact);
      },
    });
    return controller.view();
  }
  if (!controller) throw Error("original installation not open");
  switch (command.kind) {
    case "start":
      return controller.start();
    case "renew-expired":
      return controller.renewExpiredPairing();
    case "exchange":
      return controller.exchange();
    case "confirm-account":
      return controller.confirmAccountAndOpenDevice(command.accountId);
    case "attest":
      return controller.attest();
    case "collections":
      return controller.listApprovedCollections();
    case "create-collection":
      return controller.createCloudCopyCollection(command.reconcile);
    case "model-setup-intent":
    case "model-resource-setup-intent":
      return controller.modelSetupIntent(command);
    case "model-setup-verified":
      await controller.finishModelSetup();
      return null;
    case "start-consent":
      return controller.startCollectionConsent(
        command.requestedCreateCollections,
      );
    case "exchange-consent":
      return controller.exchangeCollectionConsent();
    case "set-foreground":
      controller.setForeground(command.active);
      return null;
    case "open-collection":
      return {
        kind: "collection",
        ...(await controller.openApprovedCollection(command.collectionId)),
      };
    case "close":
      await controller.close();
      lifetime.abort();
      controller = null;
      return null;
  }
}
port.onmessage = (event) => {
  const request = event.data;
  if (
    !request ||
    request.version !== 1 ||
    !Number.isInteger(request.id) ||
    request.id <= lastId ||
    request.id > 0xffffffff ||
    !isNextInstallationCommand(request.command)
  ) {
    lifetime.abort();
    port.close();
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
      (result) => {
        const response: NextInstallationResponse = {
          version: 1,
          id: request.id,
          ok: true,
          result,
        };
        if (
          result &&
          !Array.isArray(result) &&
          "kind" in result &&
          result.kind === "collection"
        )
          port.postMessage(response, [result.channel]);
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
