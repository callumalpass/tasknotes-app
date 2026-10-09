import runtimeUrl from "../../vendor/mdbase-app-lab-e31916f5.wasm?url";
import { appReleaseTrust } from "../../vendor/mdbase-app-lab-trust.mjs";
import type { TaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  type NextInstallationBuildInput,
} from "./next-installation-protocol";
import { fetchBundledAsset } from "./next-bundled-asset";
const runtimeSha256 =
  "e31916f5ca96c1a8e220b7ef7aa67a8d20c26945f1ffb78f7108d9c9a79636e2";
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
  return { ...selected, release: appReleaseTrust(), runtime, runtimeSha256 };
}
