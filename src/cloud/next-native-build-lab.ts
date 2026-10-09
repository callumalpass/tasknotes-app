import runtimeUrl from "../../vendor/mdbase-app-lab-c59379cb.wasm?url";
import { appReleaseTrust } from "../../vendor/mdbase-app-lab-trust.mjs";
import type { TaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  type NextInstallationBuildInput,
} from "./next-installation-protocol";
import { fetchBundledAsset } from "./next-bundled-asset";
const runtimeSha256 =
  "c59379cbf99c2f9c1fbfa4729c69d497ddff68aadce97daac768fc38fb136b9e";
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
