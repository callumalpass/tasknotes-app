const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const STORE_VERSION = /^\d+\.\d+\.\d+$/;

export interface BuildIdentity {
  /** The version a person sees: the store version for a store build. */
  readonly version: string;
  /** The full source commit, when the build was given one. */
  readonly commit: string | null;
  /** `version` alone, or `version-<12-hex commit>` when the commit is known. */
  readonly revision: string;
}

/**
 * Names a build by what was actually shipped. Store builds (#492) bind an
 * exact source and store version in `TASKNOTES_STORE_SOURCE` and
 * `TASKNOTES_STORE_VERSION`; package.json's version is only the shared
 * marketing version and stops moving when store builds number themselves.
 * The web publisher passes `TASKNOTES_BUILD_COMMIT`.
 */
export function buildIdentity(
  packageVersion: string,
  environment: Readonly<Record<string, string | undefined>>,
): BuildIdentity {
  const storeVersion = environment.TASKNOTES_STORE_VERSION ?? "";
  const version = STORE_VERSION.test(storeVersion)
    ? storeVersion
    : packageVersion;
  const commit =
    [environment.TASKNOTES_BUILD_COMMIT, environment.TASKNOTES_STORE_SOURCE]
      .map((candidate) => candidate ?? "")
      .find((candidate) => SOURCE_COMMIT.test(candidate)) ?? null;
  return {
    version,
    commit,
    revision: commit ? `${version}-${commit.slice(0, 12)}` : version,
  };
}
