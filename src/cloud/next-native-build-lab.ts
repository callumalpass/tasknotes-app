import runtimeUrl from "../../vendor/mdbase-app-lab-5f1ea5b2.wasm?url";
import { appReleaseTrust } from "../../vendor/mdbase-app-lab-trust.mjs";
import type { TaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  type NextInstallationBuildInput,
} from "./next-installation-protocol";
import { fetchBundledAsset } from "./next-bundled-asset";
import { TASKNOTES_APPLICATION_REGISTRATION } from "./next-application-registration";
const runtimeSha256 =
  "5f1ea5b2ab8809794ea6da8ef8609e53651551716a57309bfa628c44f497ddf2";
/** Fixed immutable LAB intake, never a production fallback or remote manifest. */
export async function loadLabNativeBuild(
  selected: TaskNotesAppEnvironment,
  signal: AbortSignal,
): Promise<NextInstallationBuildInput> {
  signal.throwIfAborted();
  if (selected.environment !== "lab" || selected.appOrigin !== location.origin)
    throw new Error("Native LAB bundle binding failed.");
  const runtime = await fetchBundledAsset(
    runtimeUrl,
    runtimeSha256,
    NATIVE_WASM_MAX_BYTES,
    signal,
  );
  return {
    ...selected,
    ...TASKNOTES_APPLICATION_REGISTRATION,
    release: appReleaseTrust(),
    runtime,
    runtimeSha256,
  };
}
