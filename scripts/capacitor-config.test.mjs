import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import capacitorConfig, {
  TASKNOTES_NATIVE_APPLICATION_ORIGIN,
} from "../capacitor.config.ts";
import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

describe("native Capacitor configuration", () => {
  it("declares the owner-approved exempt encryption use without an export compliance code", async () => {
    const plist = await source("../ios/App/App/Info.plist");
    expect(plist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/,
    );
    expect(plist).not.toContain("ITSEncryptionExportComplianceCode");
  });
  it("retains the exact production manifest origin in Android webviews", async () => {
    const [manifest, manifestWriter] = await Promise.all([
      buildTaskNotesManifest({
        appUrl: TASKNOTES_NATIVE_APPLICATION_ORIGIN,
        webOnly: false,
      }),
      source("./write-manifest.mjs"),
    ]);
    const manifestOrigin = new URL(manifest.homepage).origin;

    expect(TASKNOTES_NATIVE_APPLICATION_ORIGIN).toBe(
      "https://app.tasknotes.dev",
    );
    expect(manifestOrigin).toBe(TASKNOTES_NATIVE_APPLICATION_ORIGIN);
    expect(manifestWriter).toContain(
      `(development ? "http://127.0.0.1:4173" : "${TASKNOTES_NATIVE_APPLICATION_ORIGIN}")`,
    );
    expect(
      `${capacitorConfig.server.androidScheme}://${capacitorConfig.server.hostname}`,
    ).toBe(manifestOrigin);
  });

  it("uses the supported Capacitor scheme on iOS without changing the app host", async () => {
    // Unlike Android, WKWebView cannot serve packaged assets through HTTP(S).
    expect(capacitorConfig.server.iosScheme).toBe("capacitor");
    expect(
      `${capacitorConfig.server.iosScheme}://${capacitorConfig.server.hostname}`,
    ).toBe("capacitor://app.tasknotes.dev");
    expect(capacitorConfig.appId).toBe("dev.tasknotes.app");
    const nativeSource = await source(
      "../ios/App/App/TaskNotesBridgeViewController.swift",
    );
    expect(nativeSource).toContain(
      `applicationOrigin = "${TASKNOTES_NATIVE_APPLICATION_ORIGIN}"`,
    );
  });

  it("packages a cookie-free, cancellable, redirect-denying signed authority transport", async () => {
    const [bridgeSource, storyboard, project] = await Promise.all([
      source("../ios/App/App/TaskNotesBridgeViewController.swift"),
      source("../ios/App/App/Base.lproj/Main.storyboard"),
      source("../ios/App/App.xcodeproj/project.pbxproj"),
    ]);
    expect(storyboard).toContain('customClass="TaskNotesBridgeViewController"');
    expect(project).toContain("TaskNotesBridgeViewController.swift in Sources");
    expect(bridgeSource).toContain(
      "registerPluginInstance(TaskNotesAuthorityHttpPlugin())",
    );
    expect(bridgeSource).toContain("URLSessionConfiguration.ephemeral");
    expect(bridgeSource).toContain("configuration.httpCookieStorage = nil");
    expect(bridgeSource).toContain("configuration.urlCredentialStorage = nil");
    expect(bridgeSource).toContain("request.httpShouldHandleCookies = false");
    expect(bridgeSource).toContain('forHTTPHeaderField: "Origin"');
    expect(bridgeSource).toContain('url.scheme == "https"');
    expect(bridgeSource).toContain("Self.proofHeaders.allSatisfy");
    expect(bridgeSource).toContain("task?.cancel()");
    expect(bridgeSource).toContain("session.invalidateAndCancel()");
    expect(capacitorConfig.ios.loggingBehavior).toBe("none");
    expect(bridgeSource).toContain("completionHandler(nil)");
    expect(bridgeSource).not.toMatch(
      /didReceive challenge|serverTrust|print\(|NSLog/,
    );
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
