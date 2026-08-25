import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("native Capacitor configuration", () => {
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
