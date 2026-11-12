// Workflow-owned browser driver. Only public served application code runs in Chromium.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const origins = {
  production: "https://app.tasknotes.dev",
  staging: "https://staging.tasknotes.dev",
};
// A fresh visitor sees Sign in, or on the web starts in this browser's unsynced
// collection. That start always shows the collection switcher with no
// collection yet ("Choose a collection"); "Connect to sync your work" appears
// only once something has been saved there, so a fresh browser may not show it.
const FIRST_SCREEN =
  /^(Sign in|Connect to sync your work|Choose a collection)$/;
const SIGN_IN = /^Sign in$/;
// Failure reasons are fixed codes, never page text, URLs or error messages.
const BOUNDED = /^[a-z,-]+$/;
const need = (ok, reason) => {
  if (!ok) throw Error(reason);
};
/** Run one check; any unbounded failure (a timeout, a browser error) becomes its code. */
async function step(reason, run) {
  try {
    return await run();
  } catch (error) {
    throw BOUNDED.test(error?.message ?? "") ? error : Error(reason);
  }
}
export function assertEntryAsset(url, source, target = "production") {
  const origin = origins[target];
  need(origin && /^[a-f0-9]{40}$/.test(source ?? ""), "invalid-source");
  const asset = new URL(url);
  need(
    asset.origin === origin &&
      new RegExp(`^/assets/[^/]+-${source.slice(0, 12)}\\.js$`).test(
        asset.pathname,
      ),
    "entry-source-mismatch",
  );
}
export async function smoke(chromium, source, target = "production") {
  const browser = await step("browser-launch-failed", () =>
    chromium.launch({ headless: true }),
  );
  const failures = new Set();
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      locale: "en-US",
      extraHTTPHeaders: {
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    page.on("pageerror", () => failures.add("uncaught-page-error"));
    page.on("console", (message) => {
      // Console errors are not page errors. In particular the Insights beacon's
      // known CSP refusal is harmless. A readiness fence is always terminal.
      if (/readiness_fenced/i.test(message.text()))
        failures.add("readiness-fenced");
    });
    const response = await step("entry-load-failed", () =>
      page.goto(origins[target] + "/", {
        waitUntil: "networkidle",
        timeout: 90000,
      }),
    );
    need(response?.status() === 200, "entry-unavailable");
    // Cloudflare injects its Insights beacon as a cross-origin module script, and
    // the shell registration script is a second same-origin module outside assets.
    const entries = (
      await step("entry-asset-required", () =>
        page
          .locator('script[type="module"][src]')
          .evaluateAll((nodes) => nodes.map((node) => node.src)),
      )
    ).filter(
      (url) =>
        new URL(url).origin === origins[target] &&
        new URL(url).pathname.startsWith("/assets/"),
    );
    need(entries.length === 1, "entry-asset-required");
    assertEntryAsset(entries[0], source, target);
    await step("entry-asset-unavailable", async () => {
      const entry = await context.request.get(entries[0]);
      need(
        entry.ok() && (await entry.body()).length > 0,
        "entry-asset-unavailable",
      );
    });
    await step("first-screen-missing", () =>
      page
        .getByRole("button", { name: FIRST_SCREEN })
        .first()
        .waitFor({ state: "visible", timeout: 60000 }),
    );
    // The unsynced workspace loads its views after it opens: let a refusal show.
    await page.waitForTimeout(5000);
    const text = await step("first-screen-unreadable", () =>
      page.locator("body").innerText(),
    );
    need(!/readiness_fenced/i.test(text), "readiness-fenced");
    need(!/Can't continue/i.test(text), "first-screen-blocked");
    need(!/Couldn't load your views/i.test(text), "views-unavailable");
    need(failures.size === 0, [...failures].sort().join(","));
    const signIn = await step(
      "first-screen-unreadable",
      async () =>
        (await page.getByRole("button", { name: SIGN_IN }).count()) > 0,
    );
    return {
      ok: true,
      source: source.slice(0, 12),
      signIn,
      unsynced: !signIn,
      cacheDisabled: true,
    };
  } finally {
    await browser.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [toolPath, receiptPath] = process.argv.slice(2);
  let report;
  try {
    const { chromium } = await step(
      "browser-tool-unavailable",
      async () =>
        import(pathToFileURL((await readFile(toolPath, "utf8")).trim()).href),
    );
    report = await smoke(chromium, process.env.SOURCE_SHA, process.env.TARGET);
  } catch (error) {
    report = {
      ok: false,
      reason: BOUNDED.test(error?.message ?? "")
        ? error.message
        : "smoke-failed",
    };
    process.exitCode = 1;
  }
  await writeFile(receiptPath, JSON.stringify(report, null, 2));
  console.log(
    report.ok
      ? "TaskNotes smoke passed"
      : `TaskNotes smoke failed: ${report.reason}`,
  );
}
