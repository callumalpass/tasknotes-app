import assert from "node:assert/strict";
import { it } from "node:test";
import {
  compareSdkVersions,
  parseSdkVersion,
  sdkReleaseIsPrerelease,
  sdkVersionAtLeast,
  sdkVersionSlug,
} from "./sdk-version.mjs";

it("accepts beta pins and exact plain versions at or above 0.1.0", () => {
  for (const version of [
    "0.1.0-beta.1",
    "0.1.0-beta.212",
    "0.1.0",
    "0.1.1",
    "0.2.0",
    "1.0.0",
    "10.20.30",
  ])
    assert.ok(parseSdkVersion(version), version);
  for (const version of [
    undefined,
    "",
    "latest",
    "^0.1.0",
    "~0.1.0",
    "v0.1.0",
    "0.1",
    "0.1.0.0",
    "0.0.9",
    "0.0.0",
    "00.1.0",
    "0.01.0",
    "0.1.00",
    "0.1.0-rc.1",
    "0.2.0-beta.1",
    "1.0.0-beta.1",
    "0.1.0+build.1",
    "0.1.0-beta.",
    " 0.1.0",
  ])
    assert.equal(parseSdkVersion(version), undefined, String(version));
});

it("sorts every beta below 0.1.0 and plain versions numerically", () => {
  const ordered = [
    "0.1.0-beta.2",
    "0.1.0-beta.10",
    "0.1.0-beta.212",
    "0.1.0",
    "0.1.1",
    "0.1.10",
    "0.2.0",
    "0.10.0",
    "1.0.0",
  ];
  for (let i = 0; i < ordered.length; i++)
    for (let j = 0; j < ordered.length; j++)
      assert.equal(
        compareSdkVersions(ordered[i], ordered[j]),
        Math.sign(i - j),
        `${ordered[i]} vs ${ordered[j]}`,
      );
  assert.throws(
    () => compareSdkVersions("latest", "0.1.0"),
    /exact SDK version required/,
  );
});

it("meets a beta floor with every plain version", () => {
  for (const version of [
    "0.1.0-beta.158",
    "0.1.0-beta.212",
    "0.1.0",
    "0.1.1",
    "1.0.0",
  ])
    assert.ok(sdkVersionAtLeast(version, "0.1.0-beta.158"), version);
  for (const version of ["0.1.0-beta.157", "0.0.1", "latest", undefined])
    assert.equal(
      sdkVersionAtLeast(version, "0.1.0-beta.158"),
      false,
      String(version),
    );
  assert.ok(sdkVersionAtLeast("0.1.2", "0.1.1"));
  assert.equal(sdkVersionAtLeast("0.1.0", "0.1.1"), false);
});

it("expects a prerelease release only for beta pins", () => {
  assert.equal(sdkReleaseIsPrerelease("0.1.0-beta.212"), true);
  assert.equal(sdkReleaseIsPrerelease("0.1.0"), false);
  assert.equal(sdkReleaseIsPrerelease("0.2.3"), false);
  assert.equal(sdkReleaseIsPrerelease("0.1.0-rc.1"), undefined);
});

it("keeps beta file name slugs and uses the full plain version", () => {
  assert.equal(sdkVersionSlug("0.1.0-beta.212"), "beta212");
  assert.equal(sdkVersionSlug("0.1.0"), "0.1.0");
  assert.equal(sdkVersionSlug("0.2.1"), "0.2.1");
  assert.throws(() => sdkVersionSlug("latest"), /exact SDK version required/);
});
