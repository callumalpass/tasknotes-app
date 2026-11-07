import { _android } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { launchNativeBrowser } from "./android-wasm-journey.mjs";
import { writeFile } from "node:fs/promises";

// No accounts or network writes: establish actual accelerated-emulator browser
// and installed-application WebView access before enabling a credentialed lane.
let phase = "device";
let device;
let chrome;
let host;
let page;
try {
  const devices = await _android.devices();
  if (devices.length !== 1) throw new Error();
  [device] = devices;
  device.setDefaultTimeout(90_000);
  phase = "chrome";
  chrome = await launchNativeBrowser(device);
  phase = "native-host";
  host = spawn(
    "adb",
    [
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "class",
      "dev.tasknotes.app.NativeWasmHostTest",
      "dev.tasknotes.app.test/androidx.test.runner.AndroidJUnitRunner",
    ],
    { stdio: "ignore" },
  );
  page = await (
    await device.webView({ pkg: "dev.tasknotes.app" }, { timeout: 90_000 })
  ).page();
  page.setDefaultTimeout(90_000);
  phase = "app-ready";
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  console.log("native-emulator-preflight: passed (Chrome, real app WebView)");
} catch {
  // This lane never clicks Sign in or receives any account input, and starts
  // from a fresh emulator. A public startup screenshot cannot contain test
  // credentials or collection data. Never capture this in the signed journey.
  try {
    if (
      page &&
      (await page
        .getByRole("button", { name: "Restart TaskNotes", exact: true })
        .isVisible())
    )
      await page.locator("details.technical-details summary").click();
    if (page)
      await page.screenshot({ path: "native-preflight.png", fullPage: true });
    else if (device)
      await writeFile("native-preflight.png", await device.screenshot());
    if (page)
      console.log(
        `native-emulator-preflight: app-origin=${new URL(page.url()).origin === "https://app.tasknotes.dev"}`,
      );
  } catch {
    /* Startup evidence is best effort, never account-bearing dumps. */
  }
  console.error(`native-emulator-preflight: failed (${phase})`);
  process.exitCode = 1;
} finally {
  try {
    execFileSync(
      "adb",
      [
        "shell",
        "am",
        "broadcast",
        "-a",
        "dev.tasknotes.test.FINISH",
        "-p",
        "dev.tasknotes.app",
      ],
      { stdio: "ignore", timeout: 10_000 },
    );
  } catch {
    /* Fixed diagnostics only; never dump device logs. */
  }
  host?.kill();
  await chrome?.close().catch(() => {});
  await device?.close().catch(() => {});
}
