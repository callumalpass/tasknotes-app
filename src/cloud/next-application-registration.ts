/** Registered application metadata supplied by the authenticated build.
 * This never migrates an existing protected app ID, namespace or credential.
 */
export interface NextApplicationRegistration {
  readonly appId: string;
  readonly appName: string;
}
export const TASKNOTES_APPLICATION_REGISTRATION: NextApplicationRegistration =
  Object.freeze({
    appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    appName: "TaskNotes",
  });
