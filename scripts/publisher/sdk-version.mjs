// SDK pin versions. `@mdbase-dev/sdk` shipped as 0.1.0-beta.N, then moved to
// plain semver from 0.1.0. Both forms are exact pins; every 0.1.0-beta.N sorts
// below 0.1.0, and plain versions compare by major, minor and patch.
const betaPin = /^0\.1\.0-beta\.(\d+)$/;
const plainPin = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The parsed pin, or undefined for anything that is not an exact SDK pin. */
export function parseSdkVersion(version) {
  if (typeof version !== "string") return undefined;
  const beta = betaPin.exec(version);
  if (beta) return { version, beta: Number(beta[1]), prerelease: true };
  const plain = plainPin.exec(version);
  if (!plain) return undefined;
  const [major, minor, patch] = plain.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  if (major === 0 && minor === 0) return undefined; // below 0.1.0
  return { version, major, minor, patch, prerelease: false };
}

function parsed(version) {
  const pin = parseSdkVersion(version);
  if (!pin) throw Error(`exact SDK version required: ${version}`);
  return pin;
}

/** Negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareSdkVersions(a, b) {
  const left = parsed(a),
    right = parsed(b);
  if (left.prerelease || right.prerelease) {
    if (left.prerelease && right.prerelease)
      return Math.sign(left.beta - right.beta);
    // 0.1.0-beta.N < 0.1.0 <= every plain pin.
    return left.prerelease ? -1 : 1;
  }
  return (
    Math.sign(left.major - right.major) ||
    Math.sign(left.minor - right.minor) ||
    Math.sign(left.patch - right.patch)
  );
}

/** Whether `version` is an exact SDK pin at or above `floor`. */
export function sdkVersionAtLeast(version, floor) {
  return (
    parseSdkVersion(version) !== undefined &&
    compareSdkVersions(version, floor) >= 0
  );
}

/** Whether the SDK GitHub release for `version` must be marked prerelease;
 * undefined when `version` is not an exact SDK pin. */
export function sdkReleaseIsPrerelease(version) {
  return parseSdkVersion(version)?.prerelease;
}

/** The vendor name component for a pin: `beta<N>` for beta pins (unchanged
 * from the beta line) and the full version string for plain pins. */
export function sdkVersionSlug(version) {
  const pin = parsed(version);
  return pin.prerelease ? version.replace(/^0\.1\.0-beta\./, "beta") : version;
}
