import runtimeUrl from "../../vendor/mdbase-app-lab-f53fb85d.wasm?url";
import { appReleaseTrust } from "../../vendor/mdbase-app-lab-trust.mjs";
import type { TaskNotesAppEnvironment } from "./app-environment";
import {
  NATIVE_WASM_MAX_BYTES,
  type NextInstallationBuildInput,
} from "./next-installation-protocol";
import { fetchBundledAsset } from "./next-bundled-asset";
const runtimeSha256 =
  "f53fb85dc34eaf9cdf80e71ffdd6eb4ee513e0e9c318b310945f40f35123c778";
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
