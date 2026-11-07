import { _android, chromium, expect } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const PACKAGE = "dev.tasknotes.app";
const ORIGIN = "https://connect.mdbase.dev";
const WAIT = 90_000;

async function until(read, timeout = WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("native-journey-deadline");
}

/** Runs against an already installed APK and the test-APK-only native host.
 * Never substitutes SDK clients, runtime loaders, protocol replies or auth.
 * Errors escaping this function must be reduced to fixed phase enums by CI.
 * No screenshots, Playwright traces, console, traffic or storage dumps. */
export async function exerciseAndroidWasm({
  email,
  password,
  collectionName,
  runId,
  setupFixture = false,
  serial,
  phase = () => {},
}) {
  if (
    !email ||
    !password ||
    !collectionName?.startsWith("[test] ") ||
    !/^agent-[a-zA-Z0-9-]+$/.test(runId)
  )
    throw new Error("native-test-fixture-required");
  const devices = await _android.devices();
  const device = devices.find((d) => !serial || d.serial() === serial);
  if (!device || (!serial && devices.length !== 1))
    throw new Error("one-owned-emulator-required");
  device.setDefaultTimeout(WAIT);
  let instrumentation;
  let chrome;
  let browser;
  let forwardedPort;
  let page;
  let taskCreated = false;
  let taskDeleted = false;
  const title = `[test] ${runId} wasm`;
  const edited = `${title} edited`;
  const checks = {};
  try {
    phase("browser-start");
    await device.shell(`am force-stop ${PACKAGE}`);
    await device.shell("am force-stop com.android.chrome");
    chrome = await device.launchBrowser({ args: ["--no-first-run"] });
    // Android Custom Tabs belong to Chrome's default profile, not the isolated
    // context returned by launchBrowser. Observe that actual native return flow.
    const unix = (await device.shell("cat /proc/net/unix")).toString();
    const sockets = [
      ...new Set(
        [...unix.matchAll(/@(playwright_[a-f0-9]+_devtools_remote)\b/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    if (sockets.length !== 1)
      throw new Error("one-owned-chrome-socket-required");
    const forwarded = await exec("adb", [
      "-s",
      device.serial(),
      "forward",
      "tcp:0",
      `localabstract:${sockets[0]}`,
    ]);
    forwardedPort = forwarded.stdout.trim();
    if (!/^\d+$/.test(forwardedPort)) throw new Error("invalid-debug-forward");
    browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${forwardedPort}`,
    );
    phase("native-host-start");
    instrumentation = spawn(
      "adb",
      [
        "-s",
        device.serial(),
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
    const connect = async () =>
      (await device.webView({ pkg: PACKAGE }, { timeout: WAIT })).page();
    page = await connect();
    page.setDefaultTimeout(WAIT);
    phase("native-sign-in");
    const previousPages = new Set(browser.contexts().flatMap((c) => c.pages()));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const portal = await until(async () => {
      for (const p of browser.contexts().flatMap((c) => c.pages())) {
        if (!previousPages.has(p) && new URL(p.url()).origin === ORIGIN)
          return p;
      }
      return null;
    });
    portal.setDefaultTimeout(WAIT);
    phase("registered-account-login");
    await until(
      async () =>
        (await portal
          .getByRole("button", { name: "Sign in", exact: true })
          .isVisible()) ||
        (await portal
          .getByRole("button", { name: "Open TaskNotes", exact: true })
          .isVisible()),
    );
    if (
      await portal
        .getByRole("button", { name: "Sign in", exact: true })
        .isVisible()
    ) {
      await portal.getByLabel("Email", { exact: true }).fill(email);
      await portal.getByLabel("Password", { exact: true }).fill(password);
      // One attempt only. Never retry or work around auth throttling.
      await portal
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
    }
    phase("fixture-grant");
    // The fixture is restricted to one explicitly registered test account.
    await expect(
      portal.getByText(`Account: ${email}`, { exact: true }),
    ).toBeVisible();
    await portal
      .getByRole("button", { name: "Open TaskNotes", exact: true })
      .waitFor();
    if (setupFixture) {
      await portal
        .getByRole("button", { name: "Create a new collection…", exact: true })
        .click();
      await portal
        .locator("#installation-collection-name")
        .fill(collectionName);
    } else {
      phase("fixture-filter");
      await portal
        .getByRole("combobox", { name: "Open in TaskNotes", exact: true })
        .fill(collectionName);
      phase("fixture-select");
      const option = portal
        .getByRole("option")
        .filter({ hasText: collectionName });
      await expect(option).toHaveCount(1);
      await option.click();
    }
    phase("fixture-approve");
    await portal
      .getByRole("button", { name: "Open TaskNotes", exact: true })
      .click();
    phase("runtime-open");
    // Resume the installed app as a user can from Android's app switcher. Only
    // its original authenticated poll completes the grant; no URL/code injection.
    await device.shell(
      "am start -n dev.tasknotes.app/dev.tasknotes.app.MainActivity",
    );
    page = await connect();
    page.setDefaultTimeout(WAIT);
    await until(async () => {
      if (
        setupFixture &&
        (await page
          .getByRole("button", { name: "Set up", exact: true })
          .isVisible())
      ) {
        await page.getByRole("button", { name: "Set up", exact: true }).click();
      }
      return await page
        .getByRole("button", { name: "New task", exact: true })
        .isVisible();
    });
    // These are the real application's Workers, not a separately built probe.
    phase("wasm-worker-observation");
    const worker = await until(async () => page.workers()[0]);
    const loadedWasm = async (worker) =>
      worker.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter(
            (r) =>
              r.responseEnd > 0 && new URL(r.name).pathname.endsWith(".wasm"),
          )
          .map((r) => new URL(r.name).pathname),
      );
    const beforeWasm = await until(async () => {
      const paths = await loadedWasm(worker);
      return paths.some((p) => /runtime[^/]*\.wasm$/.test(p)) &&
        paths.some((p) => /sqlite[^/]*\.wasm$/.test(p))
        ? paths
        : null;
    });
    checks["runtime-initialized"] = true;
    phase("task-create");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("combobox", { name: "New task title" }).fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    taskCreated = true;
    await page.getByRole("button", { name: title, exact: true }).click();
    phase("task-edit");
    const input = page.getByLabel("Task title", { exact: true });
    await input.fill(edited);
    await input.press("Enter");
    await expect(page.getByTestId("collection-write-status")).toBeHidden();
    // Destruction must close the old Worker. Reloading a view or swapping a
    // repository is NOT a SQLite reopen and cannot satisfy this assertion.
    let workerClosed = false;
    worker.on("close", () => {
      workerClosed = true;
    });
    phase("sqlite-reopen");
    await device.shell(
      "am broadcast -a dev.tasknotes.test.REOPEN -p dev.tasknotes.app",
    );
    await until(async () => workerClosed);
    page = await connect();
    page.setDefaultTimeout(WAIT);
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
      edited,
    );
    const reopened = await until(async () => page.workers()[0]);
    if (reopened === worker) throw new Error("original-worker-not-retired");
    const afterWasm = await until(async () => {
      const paths = await loadedWasm(reopened);
      return beforeWasm.every((p) => paths.includes(p)) ? paths : null;
    });
    checks["sqlite-open-query-write-reopen"] = true;
    checks["task-create-edit-reload"] = true;
    phase("owned-task-cleanup");
    await page
      .getByRole("button", { name: "Delete task", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete task", exact: true })
      .click();
    await expect(page.locator(".undo-toast")).toBeVisible();
    await expect(page.locator(".undo-toast")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("collection-write-status")).toBeHidden();
    taskDeleted = true;
    return { checks, wasmPaths: afterWasm, cleanup: "owned-task-deleted" };
  } finally {
    phase(
      taskCreated && !taskDeleted ? "cleanup-required" : "native-host-close",
    );
    // Stop the test-only native host. Never log credentials, portal URLs, DOM,
    // SDK errors or raw Playwright assertions (they can include private values).
    await device
      .shell("am broadcast -a dev.tasknotes.test.FINISH -p dev.tasknotes.app")
      .catch(() => {});
    instrumentation?.kill();
    await browser?.close().catch(() => {});
    await chrome?.close().catch(() => {});
    if (forwardedPort)
      await exec("adb", [
        "-s",
        device.serial(),
        "forward",
        "--remove",
        `tcp:${forwardedPort}`,
      ]).catch(() => {});
    await device.close().catch(() => {});
  }
}
