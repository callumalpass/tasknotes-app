import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import capacitorConfig, {
  TASKNOTES_NATIVE_APPLICATION_ORIGIN,
} from "../capacitor.config.ts";
import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

describe("native Capacitor configuration", () => {
  it("packages a cookie-free, cancellable, redirect-denying signed authority transport", async () => {
    const [source, storyboard, project] = await Promise.all([
      readFile(
        resolve(
          process.cwd(),
          "ios/App/App/TaskNotesBridgeViewController.swift",
        ),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), "ios/App/App/Base.lproj/Main.storyboard"),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), "ios/App/App.xcodeproj/project.pbxproj"),
        "utf8",
      ),
    ]);
    expect(storyboard).toContain('customClass="TaskNotesBridgeViewController"');
    expect(project).toContain("TaskNotesBridgeViewController.swift in Sources");
    expect(source).toContain(
      "registerPluginInstance(TaskNotesAuthorityHttpPlugin())",
    );
    expect(source).toContain("URLSessionConfiguration.ephemeral");
    expect(source).toContain("configuration.httpCookieStorage = nil");
    expect(source).toContain("configuration.urlCredentialStorage = nil");
    expect(source).toContain("request.httpShouldHandleCookies = false");
    expect(source).toContain('forHTTPHeaderField: "Origin"');
    expect(source).toContain('url.scheme == "https"');
    expect(source).toContain("Self.proofHeaders.allSatisfy");
    expect(source).toContain("task?.cancel()");
    expect(source).toContain("session.invalidateAndCancel()");
    expect(capacitorConfig.ios.loggingBehavior).toBe("none");
    expect(source).toContain("completionHandler(nil)");
    expect(source).not.toMatch(
      /didReceive challenge|serverTrust|print\(|NSLog/,
    );
  });

  it("retains the exact production manifest origin in Android webviews", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: TASKNOTES_NATIVE_APPLICATION_ORIGIN,
      webOnly: false,
    });
    const manifestOrigin = new URL(manifest.homepage).origin;

    expect(TASKNOTES_NATIVE_APPLICATION_ORIGIN).toBe(
      "https://app.tasknotes.dev",
    );
    expect(manifestOrigin).toBe(TASKNOTES_NATIVE_APPLICATION_ORIGIN);
    expect(
      `${capacitorConfig.server.androidScheme}://${capacitorConfig.server.hostname}`,
    ).toBe(manifestOrigin);
  });

  it("uses the supported Capacitor scheme on iOS without changing the app host", () => {
    expect(capacitorConfig.server.iosScheme).toBe("capacitor");
    expect(
      `${capacitorConfig.server.iosScheme}://${capacitorConfig.server.hostname}`,
    ).toBe("capacitor://app.tasknotes.dev");
    expect(capacitorConfig.appId).toBe("dev.tasknotes.app");
  });

  it("keeps both iOS marketing versions aligned with an app version newer than 1.0.8", async () => {
    const { version } = JSON.parse(await source("../package.json"));
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = version.split(".").map(Number);
    expect(major > 1 || (major === 1 && (minor > 0 || patch > 8))).toBe(true);
    const project = await source("../ios/App/App.xcodeproj/project.pbxproj");
    const versions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(
      (match) => match[1],
    );
    expect(versions).toEqual([version, version]);
    const builds = [
      ...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g),
    ].map((match) => Number(match[1]));
    expect(builds).toHaveLength(2);
    expect(builds.every((build) => build > 25)).toBe(true);
    const releaseWorkflow = await source(
      "../.github/workflows/ios-release.yml",
    );
    expect(releaseWorkflow).toContain('if [ "$GITHUB_RUN_NUMBER" -le 25 ]');
  });

  it("declares the bundled in-app encryption for App Store export questions", async () => {
    const plist = await source("../ios/App/App/Info.plist");
    expect(plist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<true\s*\/>/,
    );
  });

  it("uses package version metadata for Android defaults while retaining explicit release overrides", async () => {
    const gradle = await source("../android/app/build.gradle");
    expect(gradle).toContain(
      "new groovy.json.JsonSlurper().parse(file('../../package.json')).version",
    );
    expect(gradle).toContain(
      "versionName tasknotesVersionName ?: tasknotesPackageVersion",
    );
    expect(gradle).toContain(
      "versionCode tasknotesVersionCode ? tasknotesVersionCode.toInteger() : 1",
    );
  });
});
