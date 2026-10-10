import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import capacitorConfig, {
  TASKNOTES_NATIVE_APPLICATION_ORIGIN,
} from "../capacitor.config.ts";
import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";

describe("native Capacitor configuration", () => {
  it("uses the canonical publisher origin and a supported iOS asset scheme", async () => {
    const [manifest, manifestWriter] = await Promise.all([
      buildTaskNotesManifest({
        appUrl: TASKNOTES_NATIVE_APPLICATION_ORIGIN,
        webOnly: false,
      }),
      readFile(resolve(process.cwd(), "scripts/write-manifest.mjs"), "utf8"),
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
    // Unlike Android, WKWebView cannot serve packaged assets through HTTP(S).
    expect(capacitorConfig.server.iosScheme).toBe("capacitor");
    expect(
      `${capacitorConfig.server.iosScheme}://${capacitorConfig.server.hostname}`,
    ).toBe("capacitor://app.tasknotes.dev");
    const nativeSource = await readFile(
      resolve(process.cwd(), "ios/App/App/TaskNotesBridgeViewController.swift"),
      "utf8",
    );
    expect(nativeSource).toContain(`applicationOrigin = "${manifestOrigin}"`);
  });

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

  it("uses the proven Android push plugin without forcing a legacy bridge", async () => {
    const source = await readFile(
      resolve(process.cwd(), "capacitor.config.ts"),
      "utf8",
    );

    expect(source).toMatch(/@capacitor\/push-notifications/);
    expect(source).not.toMatch(/useLegacyBridge/);
  });

  it("contains no device-filesystem storage bridge", async () => {
    const [
      packageSource,
      config,
      androidSettings,
      androidActivity,
      iosPackage,
    ] = await Promise.all([
      readFile(resolve(process.cwd(), "package.json"), "utf8"),
      readFile(resolve(process.cwd(), "capacitor.config.ts"), "utf8"),
      readFile(
        resolve(process.cwd(), "android/capacitor.settings.gradle"),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "android/app/src/main/java/dev/tasknotes/app/MainActivity.java",
        ),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), "ios/App/CapApp-SPM/Package.swift"),
        "utf8",
      ),
    ]);

    for (const source of [
      packageSource,
      config,
      androidSettings,
      androidActivity,
      iosPackage,
    ]) {
      expect(source).not.toMatch(/capacitor[-/]filesystem/i);
      expect(source).not.toMatch(/FolderAccess/);
    }
  });

  it("packages the optional iOS Firebase configuration before signing", async () => {
    const [xcodeProject, releaseWorkflow] = await Promise.all([
      readFile(
        resolve(process.cwd(), "ios/App/App.xcodeproj/project.pbxproj"),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), ".github/workflows/ios-release.yml"),
        "utf8",
      ),
    ]);

    expect(xcodeProject).toMatch(/Copy Firebase configuration/);
    expect(xcodeProject).toMatch(
      /TARGET_BUILD_DIR.*UNLOCALIZED_RESOURCES_FOLDER_PATH.*GoogleService-Info\.plist/,
    );
    expect(releaseWorkflow).toMatch(
      /TaskNotes\.xcarchive\/Products\/Applications\/App\.app\/GoogleService-Info\.plist/,
    );
    expect(releaseWorkflow).toMatch(/configured_bundle_id/);
  });
});
