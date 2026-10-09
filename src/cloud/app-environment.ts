/** Callum's replace-at-cutover target. LAB remains an explicit isolated build. */
export const TASKNOTES_PRODUCTION_ORIGIN = "https://app.tasknotes.dev";
export const TASKNOTES_LAB_ORIGIN = "http://127.0.0.1:48218";
export const APP_ENVIRONMENT_CONFIG_KEY = "VITE_TASKNOTES_ENVIRONMENT";
export const LAB_ORIGIN_CONFIG_KEY = "VITE_TASKNOTES_LAB_ORIGIN";
export interface TaskNotesAppEnvironment {
  readonly environment: "lab" | "production";
  readonly appOrigin: string;
}
/** No authority or runtime trust is inferred here. The authenticated release
 * module/artifact must precede next host startup. No old-data inspection gate. */
export function requireTaskNotesAppEnvironment(
  configuredEnvironment: unknown,
  configuredLabOrigin: unknown,
  currentOrigin: string,
): TaskNotesAppEnvironment {
  if (configuredEnvironment !== "lab" && configuredEnvironment !== "production")
    throw new Error(
      `${APP_ENVIRONMENT_CONFIG_KEY} must explicitly select LAB or production.`,
    );
  if (configuredEnvironment === "production") {
    if (configuredLabOrigin !== undefined && configuredLabOrigin !== "")
      throw new Error("Production cannot include a LAB app origin.");
    if (currentOrigin !== TASKNOTES_PRODUCTION_ORIGIN)
      throw new Error(
        "TaskNotes production replaces the old app at app.tasknotes.dev.",
      );
    return Object.freeze({
      environment: "production",
      appOrigin: TASKNOTES_PRODUCTION_ORIGIN,
    });
  }
  if (configuredLabOrigin !== TASKNOTES_LAB_ORIGIN)
    throw new Error(
      `${LAB_ORIGIN_CONFIG_KEY} must select the fixed isolated LAB harness origin.`,
    );
  if (currentOrigin !== TASKNOTES_LAB_ORIGIN)
    throw new Error(
      "TaskNotes LAB must open at its configured isolated harness origin.",
    );
  return Object.freeze({ environment: "lab", appOrigin: TASKNOTES_LAB_ORIGIN });
}
