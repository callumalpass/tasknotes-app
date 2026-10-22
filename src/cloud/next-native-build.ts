import { requireTaskNotesAppEnvironment } from "./app-environment";
import type { NextInstallationBuildInput } from "./next-installation-protocol";

/** Compile-time selection only. Redirects, cookies and stored account metadata
 * cannot choose a release or turn the isolated LAB bundle into production. */
export function requireNativeBuildSelection(
  mode: unknown,
  environment: unknown,
  labOrigin: unknown,
  currentOrigin: string,
) {
  if (mode !== "lab" || environment !== "lab")
    throw new Error(
      "This native app build has no authenticated release bundle. Preserve device storage until a configured build is available.",
    );
  return requireTaskNotesAppEnvironment(environment, labOrigin, currentOrigin);
}

export async function loadNativeBuild(
  signal: AbortSignal,
): Promise<NextInstallationBuildInput> {
  const selected = requireNativeBuildSelection(
    import.meta.env.MODE,
    import.meta.env.VITE_TASKNOTES_ENVIRONMENT,
    import.meta.env.VITE_TASKNOTES_LAB_ORIGIN,
    location.origin,
  );
  signal.throwIfAborted();
  // The non-LAB build never loads LAB trust or native bytes.
  if (import.meta.env.MODE !== "lab")
    throw new Error("Native bundle unavailable.");
  const { loadLabNativeBuild } = await import("./next-native-build-lab");
  return loadLabNativeBuild(selected, signal);
}
