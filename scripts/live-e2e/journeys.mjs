import { expect } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { expected, once, ownedPath, redact, saveReport } from "./support.mjs";

/** UI-only helpers. Caller owns the browser and has completed ordinary approval.
 * Native state is never replaced by fixture globals or copied SDK stores.
 */
export class UserJourney {
  constructor(page, root) {
    this.page = page;
    this.root = ownedPath(root);
    this.clicks = 0;
    this.measurements = [];
    this.reportPath = resolve(
      this.root,
      `journeys-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  }

  async click(locator) {
    await locator.click();
    this.clicks++;
  }

  async measure(action, perform, observe, { mutating = false } = {}) {
    const start = performance.now();
    const clicksBefore = this.clicks;
    let result = "passed";
    let error;
    try {
      if (mutating) await once(this.root, action, perform);
      else await perform();
      await observe();
    } catch (reason) {
      result = "failed";
      error = redact(reason.message);
    }
    const entry = {
      action,
      result,
      elapsedMs: Math.round(performance.now() - start),
      clicks: this.clicks - clicksBefore,
      ...(error ? { error } : {}),
    };
    this.measurements.push(entry);
    await saveReport(this.reportPath, this.measurements);
    if (result === "failed")
      throw Error(
        `Journey failed: ${action}; inspect evidence before retrying`,
      );
  }

  async screenshot(label) {
    if (
      !/^[a-z0-9-]+$/.test(label) ||
      new URL(this.page.url()).origin !== new URL(expected.url).origin
    )
      throw Error("Screenshot allowed only on owned app surface");
    // Mask inputs and exact private text leaves. Never capture the portal,
    // approval links' URLs, browser chrome, storage, network bodies or traces.
    await this.page.evaluate(() => {
      for (const element of globalThis.document.querySelectorAll("*")) {
        if (element.children.length !== 0) continue;
        if (
          /@|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b\d{6}\b/i.test(
            element.textContent ?? "",
          )
        )
          element.setAttribute("data-e2e-private", "true");
      }
    });
    const path = ownedPath(resolve(this.root, `${label}.png`));
    await this.page.screenshot({
      path,
      fullPage: true,
      mask: [
        this.page.locator("input, textarea, select, code, [data-e2e-private]"),
      ],
    });
    return path;
  }

  async openView(name) {
    await this.measure(
      `view-${name.toLowerCase()}`,
      () => this.click(this.page.getByRole("button", { name, exact: true })),
      () =>
        expect(
          this.page.getByRole("heading", { name, exact: true, level: 1 }),
        ).toBeVisible({ timeout: 20000 }),
    );
  }

  async createTask(title, { action = "task-create" } = {}) {
    if (!title.startsWith("[test] e2e-"))
      throw Error("Disposable task title required");
    await this.page.getByLabel("New task title", { exact: true }).fill(title);
    await this.measure(
      action,
      () =>
        this.click(this.page.getByRole("button", { name: "Add", exact: true })),
      () =>
        expect(
          this.page.getByRole("button", { name: title, exact: true }),
        ).toBeVisible({
          timeout: 30000,
        }),
      { mutating: true },
    );
  }

  async openTask(title) {
    await this.measure(
      "task-open",
      () =>
        this.click(this.page.getByRole("button", { name: title, exact: true })),
      () =>
        expect(
          this.page.getByRole("region", { name: "Task details", exact: true }),
        ).toBeVisible(),
    );
  }

  async editTaskTitle(title) {
    if (!title.startsWith("[test] e2e-"))
      throw Error("Disposable task title required");
    await this.measure(
      "task-edit",
      async () => {
        await this.page.getByLabel("Task title", { exact: true }).fill(title);
        await this.click(
          this.page.getByRole("button", { name: "Back", exact: true }),
        );
      },
      () =>
        expect(
          this.page.getByRole("button", { name: title, exact: true }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
  }

  async completeTask() {
    await this.measure(
      "task-complete",
      () =>
        this.click(
          this.page.getByRole("button", {
            name: "Complete task",
            exact: true,
          }),
        ),
      () =>
        expect(
          this.page.getByRole("button", {
            name: "Reopen task",
            exact: true,
          }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
  }

  async reloadAndObserve(observe) {
    await this.measure("reload-persistence", () => this.page.reload(), observe);
  }
}
