import { _android, chromium, expect } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const PACKAGE = "dev.tasknotes.app";
const ORIGIN = "https://connect.mdbase.dev";
const WAIT = 90_000;
const APP_ORIGIN = "https://app.tasknotes.dev";

// AndroidWebView.page() caches its first Page, even after Activity recreation.
// Retain the CDP context, not that Page. Never retry a write on a new target.
export function liveApplicationPage(context, retired = null) {
  return context.pages().find((candidate) => {
    if (candidate === retired || candidate.isClosed()) return false;
    try {
      return new URL(candidate.url()).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  });
}

async function until(read, timeout = WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("native-journey-deadline");
}

// Playwright's Android launchBrowser has no timeout option. A missing Chrome
// debugging socket must fail preflight, not leave the host/credential lane hung.
export async function launchNativeBrowser(device, timeout = WAIT) {
  let timer;
  try {
    return await Promise.race([
      device.launchBrowser({ args: ["--no-first-run"] }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("native-browser-start-deadline")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function openNativeWorkspace(page) {
  const setup = page.getByRole("button", { name: "Set up", exact: true });
  const ready = page.getByRole("button", { name: "New task", exact: true });
  const state = await until(async () => {
    if (await ready.isVisible()) return "ready";
    if (await setup.isVisible()) return "setup";
    return null;
  });
  if (state === "setup") await setup.click();
  await ready.waitFor({ state: "visible" });
}

async function readAccountAccess(page) {
  return page.evaluate(async () => {
    const response = await fetch("/v1/me", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("account-access-read-failed");
    const data = await response.json();
    if (!Array.isArray(data.installation_access) || !Array.isArray(data.grants))
      throw new Error("account-access-shape-invalid");
    return { installations: data.installation_access, grants: data.grants };
  });
}

export function ownedFixtureInstallations(before, after, collectionName) {
  const previous = new Set(before.installations.map((i) => i.connector_id));
  const owned = after.installations.filter(
    (i) =>
      !previous.has(i.connector_id) && i.collection_name === collectionName,
  );
  const connectors = [...new Set(owned.map((i) => i.connector_id))];
  for (const connector of connectors) {
    const scopes = after.installations.filter(
      (i) => i.connector_id === connector,
    );
    if (
      scopes.some(
        (i) =>
          i.collection_name !== collectionName ||
          i.application_name !== "TaskNotes" ||
          i.application_origin !== APP_ORIGIN,
      )
    )
      throw new Error("installation-cleanup-ownership-ambiguous");
  }
  return connectors;
}

async function deleteOwnedTask(page, title, edited) {
  const input = page.getByLabel("Task title", { exact: true });
  if (!(await input.isVisible())) {
    await page
      .getByRole("button", { name: title, exact: true })
      .or(page.getByRole("button", { name: edited, exact: true }))
      .click();
  }
  if (![title, edited].includes(await input.inputValue()))
    throw new Error("owned-task-required");
  await page
    .getByRole("button", { name: "More task actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(page.locator(".undo-toast")).toBeVisible();
  await expect(page.locator(".undo-toast")).toBeHidden({ timeout: 45_000 });
  await expect(page.getByTestId("collection-write-status")).toBeHidden();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: edited, exact: true }),
  ).toHaveCount(0);
}

async function revokeOwnedFixtureAccess(browser, before, collectionName) {
  const management = await browser.contexts()[0].newPage();
  try {
    await management.goto(ORIGIN);
    const current = await readAccountAccess(management);
    const owned = ownedFixtureInstallations(before, current, collectionName);
    for (const connector of owned) {
      const ok = await management.evaluate(async (connector) => {
        const response = await fetch(
          `/v1/account/installations/${encodeURIComponent(connector)}`,
          { method: "DELETE", headers: { accept: "application/json" } },
        );
        return response.ok;
      }, connector);
      if (!ok) throw new Error("installation-revoke-failed");
    }
    const after = await readAccountAccess(management);
    if (after.installations.some((i) => owned.includes(i.connector_id)))
      throw new Error("installation-cleanup-not-verified");
    if (
      after.grants.some(
        (g) => g.collection_name === collectionName && !g.revoked_at,
      )
    )
      throw new Error("fixture-grant-cleanup-not-verified");
  } finally {
    await management.close().catch(() => {});
  }
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
  let accessBefore;
  let connect;
  let taskCreated = false;
  let taskDeleted = false;
  let deleteAttempted = false;
  const title = `[test] ${runId} wasm`;
  const edited = `${title} edited`;
  const checks = {};
  let result;
  let failure;
  let cleanupFailed = false;
  try {
    phase("browser-start");
    await device.shell(`am force-stop ${PACKAGE}`);
    await device.shell("am force-stop com.android.chrome");
    chrome = await launchNativeBrowser(device);
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
    const initialPage = await (
      await device.webView({ pkg: PACKAGE }, { timeout: WAIT })
    ).page();
    const context = initialPage.context();
    connect = (retired = null) =>
      until(async () => liveApplicationPage(context, retired));
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
    accessBefore = await readAccountAccess(portal);
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
    // A retained collection may still need its first TaskNotes model setup.
    // Creating the collection and initializing its model are independent. Do
    // not put the setup write in a polling callback: submit exactly once.
    await openNativeWorkspace(page);
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
    // Resource loading is not exercised runtime proof. Flags are set only
    // after the real task write and reopened-database read below have passed.
    phase("task-create");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("combobox", { name: "New task title" }).fill(title);
    // Once submitted, an error is an unknown write, not proof of absence.
    taskCreated = true;
    await page.getByRole("button", { name: "Add", exact: true }).click();
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
    page = await connect(page);
    page.setDefaultTimeout(WAIT);
    // A new document does not retain the old route or its task-detail dialog.
    // Query the reopened database through the normal task list first.
    if (!(await page.getByLabel("Task title", { exact: true }).isVisible()))
      await page.getByRole("button", { name: edited, exact: true }).click();
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
      edited,
    );
    const reopened = await until(async () => page.workers()[0]);
    if (reopened === worker) throw new Error("original-worker-not-retired");
    const afterWasm = await until(async () => {
      const paths = await loadedWasm(reopened);
      return beforeWasm.every((p) => paths.includes(p)) ? paths : null;
    });
    checks["runtime-initialized"] = true;
    checks["sqlite-open-query-write-reopen"] = true;
    checks["task-create-edit-reload"] = true;
    phase("owned-task-cleanup");
    deleteAttempted = true;
    await deleteOwnedTask(page, title, edited);
    taskDeleted = true;
    result = {
      checks,
      wasmPaths: afterWasm,
      cleanup: "owned-task-deleted-and-installation-access-revoked",
    };
  } catch (error) {
    failure = error;
  } finally {
    // Keep the original host alive until owned data is removed, including when
    // an assertion fails after creation. Never retry an unknown delete write.
    if (taskCreated && !taskDeleted) {
      phase("failure-task-cleanup");
      if (deleteAttempted) {
        cleanupFailed = true;
      } else {
        try {
          deleteAttempted = true;
          page = await connect();
          await deleteOwnedTask(page, title, edited);
          taskDeleted = true;
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (accessBefore && browser?.isConnected() && !cleanupFailed) {
      phase("owned-installation-cleanup");
      try {
        await revokeOwnedFixtureAccess(browser, accessBefore, collectionName);
      } catch {
        cleanupFailed = true;
      }
    } else if (accessBefore) {
      cleanupFailed = true;
    }
    phase(cleanupFailed ? "cleanup-required" : "native-host-close");
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
  if (cleanupFailed) throw new Error("native-fixture-cleanup-required");
  if (failure) throw failure;
  return result;
}
