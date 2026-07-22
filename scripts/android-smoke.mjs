import { execFileSync } from "node:child_process";

const PACKAGE = "dev.tasknotes.app";
const COLLECTION = "/storage/emulated/0/Documents/TaskNotes";
const TASKS = "/storage/emulated/0/Documents/TaskNotes/tasks";
const DEVTOOLS_PORT = 9222;
const runId = Date.now().toString(36);
const initialTitle = `Android smoke ${runId}`;

function adb(...args) {
  return execFileSync("adb", args, { encoding: "utf8" }).trim();
}

function launch() {
  adb("shell", "am", "force-stop", PACKAGE);
  adb(
    "shell",
    "monkey",
    "-p",
    PACKAGE,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  );
}

function taskFiles() {
  try {
    const output = adb("shell", "ls", "-1", TASKS);
    return output ? new Set(output.split("\n")) : new Set();
  } catch {
    return new Set();
  }
}

function readTask(file) {
  return adb("shell", "cat", `${TASKS}/${file}`);
}

async function waitFor(check, description, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function main() {
  const devices = adb("devices")
    .split("\n")
    .slice(1)
    .filter((line) => line.endsWith("\tdevice"));
  if (devices.length !== 1)
    throw new Error(`Expected one Android device; found ${devices.length}.`);

  const backup = `${COLLECTION}.before-${runId}`;
  adb("shell", "am", "force-stop", PACKAGE);
  const collectionPresent = pathExists(COLLECTION);
  if (collectionPresent) adb("shell", "mv", "--", COLLECTION, backup);
  const before = taskFiles();
  let createdFile;
  let devtools;
  try {
    launch();
    devtools = await connectToWebView();
    await devtools.evaluate(`
      localStorage.removeItem("tasknotes:collection-choice:v1");
      indexedDB.deleteDatabase("tasknotes-index-v2");
      location.replace("/");
    `);

    // First-run storage choice → Today → quick capture.
    await waitFor(
      () => devtools.hasText("On this device"),
      "the first-run collection choice",
    );
    await devtools.clickButton("On this device");
    await waitFor(() => devtools.hasText("Today"), "the Today screen");
    await devtools.fillInput("New task title", initialTitle);
    await devtools.clickButton("Add", true);

    createdFile = await waitFor(() => {
      const added = [...taskFiles()].filter((file) => !before.has(file));
      return added.length === 1 ? added[0] : undefined;
    }, "the native Markdown record");
    if (!readTask(createdFile).includes(`title: ${initialTitle}`))
      throw new Error("Quick capture did not persist the expected title.");

    // Schedule through the real LocalNotifications bridge and confirm the
    // native plugin has retained the reminder.
    adb(
      "shell",
      "pm",
      "grant",
      PACKAGE,
      "android.permission.POST_NOTIFICATIONS",
    );
    await waitFor(
      () => devtools.hasTaskRow(initialTitle),
      "the created task row",
    );
    await devtools.openTask(initialTitle);
    await waitFor(() => devtools.hasText("MARKDOWN RECORD"), "task details");
    const reminder = localDateTime(new Date(Date.now() + 60 * 60 * 1_000));
    await devtools.fillNamedInput("Reminder date and time", reminder);
    await waitFor(
      () =>
        devtools.evaluate(`(async () => {
          const pending = await Capacitor.Plugins.LocalNotifications.getPending();
          return pending.notifications.some((notification) =>
            notification.title === ${JSON.stringify(initialTitle)}
          );
        })()`),
      "the native scheduled reminder",
    );
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitFor(
      () => devtools.hasSelector("#today-title"),
      "hardware Back to return to Today",
    );
    // Kill and relaunch to prove that the public Markdown record survives
    // process death and remains the source of truth.
    devtools.close();
    launch();
    devtools = await connectToWebView();
    if (!readTask(createdFile).includes(`title: ${initialTitle}`))
      throw new Error("The Markdown record did not survive an app relaunch.");
    await waitFor(
      () => devtools.hasText(initialTitle),
      "the persisted task after app relaunch",
    );

    // Execute and render a real Obsidian Base through the packaged native
    // storage adapter.
    const viewSource = `formulas:
  surface: '"Native"'
properties:
  formula.surface:
    displayName: Surface
views:
  - type: tasknotesKanban
    name: Android board
    groupBy:
      property: status
      direction: ASC
    order: [status, formula.surface]
`;
    await devtools.evaluate(`Capacitor.Plugins.Filesystem.writeFile({
      path: "TaskNotes/views/android-smoke.base",
      directory: "DOCUMENTS",
      encoding: "utf8",
      data: ${JSON.stringify(viewSource)},
      recursive: true
    })`);
    await waitFor(
      () =>
        devtools.evaluate(`Capacitor.Plugins.Filesystem.readdir({
          path: "TaskNotes/views",
          directory: "DOCUMENTS"
        }).then(({ files }) => files.some(({ name }) => name === "android-smoke.base"))`),
      "the native saved-view file to become visible",
    );
    await devtools.clickButton("More", true);
    await waitFor(() => devtools.hasText("Saved views"), "the More screen");
    await devtools.clickButton("Saved views");
    await waitFor(
      () => devtools.hasText("Android board"),
      "the native saved view",
    );
    await devtools.clickNamedButton("Add Android board to navigation");
    await devtools.clickButton("Android board");
    await waitFor(
      () =>
        devtools.hasSelector('.kanban-board[aria-label="Android board board"]'),
      "the native Kanban board",
    );
    if (!(await devtools.hasText(initialTitle)))
      throw new Error(
        "The native saved view did not include the persisted task.",
      );
    if (
      !(await devtools.hasText("Surface")) ||
      !(await devtools.hasText("Native"))
    )
      throw new Error(
        "The native saved view did not render its configured formula property.",
      );

    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitFor(
      () => devtools.hasSelector("#today-title"),
      "hardware Back from the operational view",
    );

    // Prove that the private-use OAuth callback is routed back into the
    // packaged app and handled by the cloud onboarding screen.
    await devtools.evaluate(`
      localStorage.setItem("tasknotes:collection-choice:v1", "cloud");
      location.replace("/");
    `);
    await waitFor(
      () => devtools.hasText("Continue to mdbase"),
      "the native cloud connection screen",
    );
    adb(
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-c",
      "android.intent.category.BROWSABLE",
      "-d",
      "dev.tasknotes.app://auth/mdbase/callback?error=access_denied\\&error_description=Native%20callback%20smoke",
      "-p",
      PACKAGE,
    );
    await waitFor(
      () => devtools.hasText("Native callback smoke"),
      "the native OAuth callback",
    );

    console.log(
      `Android smoke passed: native capture, public Markdown write, scheduled reminder, hardware Back routing, relaunch persistence, saved-view execution, Kanban rendering, and OAuth callback routing (${createdFile}).`,
    );
  } finally {
    if (devtools) {
      await devtools
        .evaluate(
          `(async () => {
          const pending = await Capacitor.Plugins.LocalNotifications.getPending();
          if (pending.notifications.length) {
            await Capacitor.Plugins.LocalNotifications.cancel({
              notifications: pending.notifications.map(({ id }) => ({ id }))
            });
          }
        })()`,
        )
        .catch(() => undefined);
      devtools.close();
    }
    adb("forward", "--remove", `tcp:${DEVTOOLS_PORT}`);
    adb("shell", "am", "force-stop", PACKAGE);
    if (pathExists(COLLECTION)) adb("shell", "rm", "-r", "--", COLLECTION);
    if (collectionPresent) adb("shell", "mv", "--", backup, COLLECTION);
  }
}

function pathExists(path) {
  try {
    adb("shell", "test", "-e", path);
    return true;
  } catch {
    return false;
  }
}

async function connectToWebView() {
  const processId = await waitFor(() => {
    try {
      return adb("shell", "pidof", PACKAGE).split(/\s+/)[0] || undefined;
    } catch {
      return undefined;
    }
  }, "the TaskNotes process");
  const socket = await waitFor(() => {
    const name = `webview_devtools_remote_${processId}`;
    return adb("shell", "cat", "/proc/net/unix").includes(`@${name}`)
      ? name
      : undefined;
  }, "the Android WebView debugger");
  adb("forward", `tcp:${DEVTOOLS_PORT}`, `localabstract:${socket}`);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`);
    if (!response.ok) return undefined;
    const targets = await response.json();
    return targets.find((candidate) => candidate.type === "page");
  }, "the TaskNotes WebView page");
  return new DevtoolsSession(target.webSocketDebuggerUrl);
}

class DevtoolsSession {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
      this.socket.addEventListener("message", (event) => {
        const value = JSON.parse(event.data);
        if (!value.id) return;
        const pending = this.pending.get(value.id);
        if (!pending) return;
        this.pending.delete(value.id);
        if (value.error) pending.reject(new Error(value.error.message));
        else pending.resolve(value.result);
      });
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text ?? "WebView evaluation failed.",
      );
    return result.result.value;
  }

  hasText(text) {
    return this.evaluate(
      `document.body?.innerText.includes(${JSON.stringify(text)})`,
    );
  }

  hasSelector(selector) {
    return this.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
  }

  hasTaskRow(title) {
    return this.evaluate(
      `[...document.querySelectorAll("button.task-row-content")].some((button) => button.innerText.includes(${JSON.stringify(title)}))`,
    );
  }

  openTask(title) {
    return this.evaluate(`(() => {
      const button = [...document.querySelectorAll("button.task-row-content")].find(
        (candidate) => candidate.innerText.includes(${JSON.stringify(title)})
      );
      if (!button) throw new Error("Task row not found: " + ${JSON.stringify(title)});
      button.click();
      return true;
    })()`);
  }

  clickButton(text, exact = false) {
    return this.evaluate(`(() => {
      const expected = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll("button")].find((candidate) =>
        ${exact ? "candidate.innerText.trim() === expected" : "candidate.innerText.includes(expected)"}
      );
      if (!button) throw new Error("Button not found: " + expected);
      button.click();
      return true;
    })()`);
  }

  fillInput(label, value) {
    return this.evaluate(`(() => {
      const label = [...document.querySelectorAll("label")].find((candidate) =>
        candidate.innerText.trim() === ${JSON.stringify(label)}
      );
      const input = label?.htmlFor
        ? document.getElementById(label.htmlFor)
        : label?.querySelector("input, textarea");
      if (!input) throw new Error("Input not found: " + ${JSON.stringify(label)});
      const setter = Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  fillNamedInput(name, value) {
    return this.evaluate(`(() => {
      const input = [...document.querySelectorAll("input")].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      if (!input) throw new Error("Input not found: " + ${JSON.stringify(name)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  clickNamedButton(name) {
    return this.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      if (!button) throw new Error("Button not found: " + ${JSON.stringify(name)});
      button.click();
      return true;
    })()`);
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function localDateTime(date) {
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

await main();
