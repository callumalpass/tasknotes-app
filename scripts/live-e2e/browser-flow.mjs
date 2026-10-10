import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { once, ownedPath, redact } from "./support.mjs";

export async function closeOwnedBrowser(context, profile) {
  ownedPath(profile);
  const closed = await Promise.race([
    context.close().then(
      () => true,
      () => false,
    ),
    delay(10000, false, { ref: false }),
  ]);
  if (closed) return "stopped";
  async function matchingChildren() {
    const { stdout } = await promisify(execFile)(
      "ps",
      ["--ppid", String(process.pid), "-o", "pid=,args="],
      { timeout: 5000 },
    ).catch(() => ({ stdout: "" }));
    return stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (parts) =>
          /^\d+$/.test(parts[0] ?? "") &&
          parts.includes(`--user-data-dir=${profile}`) &&
          parts[1]?.includes("chrome-headless-shell"),
      )
      .map((parts) => Number(parts[0]));
  }
  const children = await matchingChildren();
  for (const pid of children) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* Child already stopped. */
    }
  }
  await delay(1500);
  for (const pid of await matchingChildren()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Child already stopped. */
    }
  }
  await delay(300);
  return (await matchingChildren()).length
    ? "cleanup-blocked"
    : "stopped-after-scoped-cleanup";
}

export const cp = "https://connect-lab.mdbase.dev";
export async function assertAccount(context, accountId) {
  const me = await context.request.get(`${cp}/v1/me`);
  if (!me.ok() || (await me.json()).user?.id !== accountId)
    throw Error("Disposable account identity mismatch");
}

export async function ordinaryLogin(context, credentials, root, marker) {
  const me = await context.request.get(`${cp}/v1/me`);
  if (me.ok()) {
    await assertAccount(context, credentials.accountId);
    return;
  }
  if (me.status() !== 401) throw Error("Unexpected portal session status");
  const portal = await context.newPage();
  try {
    await portal.goto(`${cp}/login`);
    await portal.getByLabel("Email", { exact: true }).fill(credentials.email);
    await portal
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await once(root, marker, () =>
      portal.getByRole("button", { name: "Sign in", exact: true }).click(),
    );
    await expect(portal.getByLabel("Password", { exact: true })).toHaveCount(
      0,
      { timeout: 30000 },
    );
    await assertAccount(context, credentials.accountId);
  } catch {
    throw Error("Ordinary disposable portal login failed");
  } finally {
    await portal.close();
  }
}

export async function appClick(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false", {
    timeout: 65000,
  });
  if (await page.getByRole("alert").count())
    throw Error(redact(await page.getByRole("alert").innerText()));
}

// Passive identity observation of the real UI's original open command. It
// neither sends additional RPCs nor reads credentials/storage nor mocks data.
// Collection identity stays in the private scenario process, not evidence.
export async function observeOwnCollectionBinding(context) {
  await context.addInitScript(() => {
    const original = globalThis.Worker.prototype.postMessage;
    globalThis.__e2eOwnCollection = null;
    globalThis.__e2eBindingAmbiguous = false;
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      if (
        message?.version === 1 &&
        message.command?.kind === "open-collection"
      ) {
        const id = message.command.collectionId;
        if (
          globalThis.__e2eOwnCollection &&
          globalThis.__e2eOwnCollection !== id
        )
          globalThis.__e2eBindingAmbiguous = true;
        globalThis.__e2eOwnCollection = id;
      }
      return Reflect.apply(original, this, [message, ...rest]);
    };
  });
}

export async function readOwnCollectionBinding(page) {
  const binding = await page.evaluate(() => ({
    id: globalThis.__e2eOwnCollection,
    ambiguous: globalThis.__e2eBindingAmbiguous,
  }));
  if (
    binding.ambiguous ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(binding.id ?? "")
  )
    throw Error("Own fixture collection binding unavailable");
  return binding.id;
}

export async function openOwnPairedCollection(page, url) {
  await page.goto(url);
  await appClick(page, "Resume this device's original sign-in");
  await appClick(page, "Confirm this account on this device");
  await appClick(page, "Refresh approved collections");
  const choices = page.locator("section ul li");
  if ((await choices.count()) !== 1)
    throw Error("Own device scope is not exactly one collection");
  await choices.getByRole("button").click();
  await page
    .getByRole("heading", { name: "Today", exact: true, level: 1 })
    .waitFor({ timeout: 65000 });
  return readOwnCollectionBinding(page);
}

export async function approveSameCollection(context, page, root, collectionId) {
  await once(root, "second-device-fresh-request", () =>
    appClick(page, "Sign in on this device"),
  );
  const href = await page
    .getByRole("link", {
      name: "Select account and approve in mdbase Connect",
      exact: true,
    })
    .getAttribute("href");
  if (new URL(href).origin !== cp) throw Error("Portal origin mismatch");
  const portal = await context.newPage();
  try {
    await portal.goto(href);
    await once(root, "second-device-select-account", () =>
      portal
        .getByRole("button", { name: "Use this account", exact: true })
        .click(),
    );
    await appClick(page, "Check original approval");
    await once(root, "second-device-confirm-account", () =>
      appClick(page, "Confirm this account on this device"),
    );
    await once(root, "second-device-attest", () =>
      appClick(page, "Send original device approval"),
    );
    await portal
      .getByRole("button", { name: "Check device key", exact: true })
      .click();
    await expect(
      portal.getByRole("button", { name: "Approve this device", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const group = portal.getByRole("group", {
      name: "Entire collections",
      exact: true,
    });
    if (
      await group
        .getByRole("checkbox")
        .evaluateAll((choices) => choices.some((choice) => choice.checked))
    )
      throw Error("Unexpected preselected collection scope");
    const target = portal
      .locator("fieldset label")
      .filter({
        has: portal
          .locator("code")
          .filter({ hasText: new RegExp(`^${collectionId}$`) }),
      })
      .getByRole("checkbox");
    await expect(target).toHaveCount(1);
    await target.check();
    const approved = portal.waitForResponse(
      (response) =>
        new URL(response.url()).origin === cp &&
        new URL(response.url()).pathname.endsWith("/approve") &&
        response.request().method() === "POST",
    );
    await once(root, "second-device-approve", () =>
      portal
        .getByRole("button", { name: "Approve this device", exact: true })
        .click(),
    );
    if ((await approved).status() !== 200)
      throw Error("Ordinary device approval did not succeed");
    await appClick(page, "Check original approval");
    await appClick(page, "Refresh approved collections");
    const choices = page.locator("section ul li");
    if ((await choices.count()) !== 1)
      throw Error("Second-device approved scope is not exactly one collection");
    await choices.getByRole("button").click();
    await page
      .getByRole("heading", { name: "Today", exact: true, level: 1 })
      .waitFor({ timeout: 65000 });
    if ((await readOwnCollectionBinding(page)) !== collectionId)
      throw Error("Second-device fixture mismatch");
  } finally {
    await portal.close();
  }
}
