import { _android } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { launchNativeBrowser } from "./android-wasm-journey.mjs";

// No accounts or network writes: establish actual accelerated-emulator browser
// and installed-application WebView access before enabling a credentialed lane.
let phase = "device";
let device;
let chrome;
let host;
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
  const page = await (
    await device.webView({ pkg: "dev.tasknotes.app" }, { timeout: 90_000 })
  ).page();
  phase = "app-ready";
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  console.log("native-emulator-preflight: passed (Chrome, real app WebView)");
} catch {
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
