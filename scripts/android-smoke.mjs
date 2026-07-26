import { execFileSync } from "node:child_process";

const PACKAGE =
  process.env.TASKNOTES_ANDROID_APPLICATION_ID ?? "dev.tasknotes.app";
const FIREBASE_PROJECT =
  process.env.TASKNOTES_FIREBASE_PROJECT_ID ?? "tasknotes-462906";
const skipFcmDelivery = process.env.TASKNOTES_ANDROID_SKIP_FCM_DELIVERY === "1";
const COLLECTION = "/storage/emulated/0/Documents/TaskNotes";
const TASKS = "/storage/emulated/0/Documents/TaskNotes/tasks";
const FOLDER_COLLECTION = "/storage/emulated/0/Documents/TaskNotesFolderSmoke";
const FOLDER_TASKS = `${FOLDER_COLLECTION}/tasks`;
const DEVTOOLS_PORT = 9222;
const runId = Date.now().toString(36);
const initialTitle = `Android smoke ${runId}`;
const parallelTitle = `Android parallel ${runId}`;
const recurringTitle = `Android recurring ${runId}`;

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

function sourceForTitle(title) {
  return [...taskFiles()]
    .map(readTask)
    .find((source) => source.includes(`title: ${title}`));
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
      localStorage.clear();
      indexedDB.deleteDatabase("tasknotes-index-v2");
      location.replace("/");
    `);

    // First-run storage choice → Today → quick capture.
    await waitFor(
      () => devtools.hasText("On this device"),
      "the first-run collection choice",
    );
    await devtools.clickButton("On this device");
    await waitFor(
      () => devtools.hasText("Use the TaskNotes folder"),
      "the local folder choice",
    );
    await devtools.clickButton("Use the TaskNotes folder");
    await waitFor(
      () =>
        devtools.evaluate(
          `[...document.querySelectorAll("label")].some((label) => label.innerText.trim() === "New task title")`,
        ),
      "the Today quick capture",
    );
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
    await verifyAndroidPush(devtools);
    await waitFor(
      () => devtools.hasTaskRow(initialTitle),
      "the created task row",
    );
    await devtools.openTask(initialTitle);
    await waitFor(() => devtools.hasText("Markdown record"), "task details");
    const reminder = localDateTime(new Date(Date.now() + 60 * 60 * 1_000));
    await devtools.clickSummary("Repeat and reminders");
    await devtools.chooseDate("Reminder date", reminder.slice(0, 10));
    await waitFor(
      () => devtools.hasEnabledNamedButton("Reminder time"),
      "the TaskNotes reminder time picker",
    );
    await devtools.chooseTime("Reminder time", reminder.slice(11, 16));
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
      () =>
        devtools.evaluate(
          `location.pathname === "/" && !document.querySelector(".detail-inspector")`,
        ),
      "hardware Back to return to Today",
    ).catch(async (reason) => {
      const text = await devtools.evaluate("document.body?.innerText");
      throw new Error(`${reason.message}\n${text}`);
    });
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
    await devtools.clickNamedButton("Edit Android board");
    await waitFor(
      () => devtools.hasSelector('.view-editor[role="dialog"]'),
      "the native view editor",
    );
    await waitFor(
      () => devtools.hasText("Filter"),
      "the loaded native view editor",
    );
    for (const section of ["View", "Filter", "Arrange", "New tasks"])
      if (!(await devtools.hasText(section)))
        throw new Error(`The native view editor did not show ${section}.`);
    await devtools.clickButton("List");
    await devtools.clickButton("Save view");
    await waitFor(
      () =>
        devtools.evaluate(
          `!document.querySelector('.view-editor') && !document.querySelector('.kanban-board')`,
        ),
      "the saved native view layout",
    );
    if (!(await devtools.hasText(initialTitle)))
      throw new Error("The edited native view lost its task result.");

    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitFor(
      () =>
        devtools.evaluate(
          `location.pathname === "/" && !document.querySelector(".detail-inspector")`,
        ),
      "hardware Back from the operational view",
    );

    // Timers belong to tasks, so unrelated work may remain active in parallel.
    // Verify both sessions through the native Markdown records.
    await waitFor(
      () => devtools.hasTaskRow(initialTitle),
      "the task row after leaving the saved view",
    );
    await devtools.openTask(initialTitle);
    await devtools.clickSummary("Time");
    await devtools.fillNamedInput("Timer description", "Native primary");
    await waitFor(
      () => devtools.hasEnabledButton("Start"),
      "the first timer start action",
    );
    await devtools.clickButton("Start", true);
    await waitFor(
      () => sourceForTitle(initialTitle)?.includes("Native primary"),
      "the first native timer",
    );
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitFor(
      () =>
        devtools.evaluate(
          `location.pathname === "/" && !document.querySelector(".detail-inspector")`,
        ),
      "Today after timer",
    );
    await devtools.fillInput("New task title", parallelTitle);
    await devtools.clickButton("Add", true);
    await waitFor(
      () => devtools.hasTaskRow(parallelTitle),
      "the parallel task",
    );
    await devtools.openTask(parallelTitle);
    await devtools.clickSummary("Time");
    await devtools.fillNamedInput("Timer description", "Native parallel");
    await waitFor(
      () => devtools.hasEnabledButton("Start"),
      "the second timer start action",
    );
    await devtools.clickButton("Start", true);
    await waitFor(
      () => sourceForTitle(parallelTitle)?.includes("Native parallel"),
      "the second native timer",
    );
    if (
      !sourceForTitle(initialTitle)?.includes("Native primary") ||
      !sourceForTitle(parallelTitle)?.includes("Native parallel")
    )
      throw new Error("Independent native timers were not both persisted.");
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitFor(
      () =>
        devtools.evaluate(
          `location.pathname === "/" && !document.querySelector(".detail-inspector")`,
        ),
      "Today after parallel timer",
    );

    // Materialize and complete a projected recurrence. The child note and the
    // parent's compatibility state must both remain durable Markdown.
    await devtools.fillInput(
      "New task title",
      `${recurringTitle} today every day`,
    );
    await devtools.clickButton("Add", true);
    await devtools.clickButton("Upcoming");
    await waitFor(
      () => devtools.hasText(recurringTitle),
      "the projected recurring task",
    );
    await devtools.evaluate(`(() => {
      const event = [...document.querySelectorAll('[role="button"][aria-label]')].find(
        (candidate) => candidate.getAttribute("aria-label")?.startsWith(${JSON.stringify(recurringTitle)})
      );
      if (!event) throw new Error("Projected occurrence not found");
      event.click();
      return true;
    })()`);
    await waitFor(
      () => devtools.hasText("Make occurrence note"),
      "the materialization action",
    ).catch(async (reason) => {
      const text = await devtools.evaluate("document.body?.innerText");
      throw new Error(`${reason.message}\n${text}`);
    });
    await devtools.clickButton("Make occurrence note", true);
    await waitFor(
      () => devtools.hasText("OCCURRENCE NOTE"),
      "the materialized occurrence note",
    );
    await waitFor(
      () => devtools.hasEnabledButton("Complete"),
      "the occurrence completion action",
    );
    await devtools.clickButton("Complete", true);
    await waitFor(
      () => devtools.hasText("Mark open"),
      "occurrence completion",
    ).catch(async (reason) => {
      const text = await devtools.evaluate("document.body?.innerText");
      throw new Error(`${reason.message}\n${text}`);
    });
    await waitFor(() => {
      const sources = [...taskFiles()].map(readTask);
      return (
        sources.filter((source) => source.includes("occurrence_date:"))
          .length === 1 &&
        sources.some(
          (source) =>
            source.includes(`title: ${recurringTitle}`) &&
            source.includes("complete_instances:"),
        )
      );
    }, "materialized occurrence reconciliation");

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
      `Android smoke passed: native capture, public Markdown write, scheduled reminder, FCM registration and foreground push, hardware Back routing, relaunch persistence, saved-view execution and editing, Kanban rendering, concurrent timers, materialized occurrence reconciliation, and OAuth callback routing (${createdFile}).`,
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
    try {
      adb("forward", "--remove", `tcp:${DEVTOOLS_PORT}`);
    } catch {
      // A failure before WebView attachment leaves no forwarding rule.
    }
    adb("shell", "am", "force-stop", PACKAGE);
    if (pathExists(COLLECTION)) adb("shell", "rm", "-r", "--", COLLECTION);
    if (collectionPresent) adb("shell", "mv", "--", backup, COLLECTION);
  }
}

async function verifyAndroidPush(devtools) {
  const signalId = `tasknotes-android-smoke-${Date.now()}`;
  const token = await devtools.evaluate(`(async () => {
    const plugin = Capacitor.Plugins.PushNotifications;
    if (!plugin) throw new Error("PushNotifications is not packaged.");
    localStorage.removeItem("tasknotes.android-smoke.push");
    await plugin.createChannel({
      id: "mdbase-updates",
      name: "Task reminders",
      description: "Reminders scheduled by TaskNotes through mdbase",
      importance: 4
    });
    const received = await plugin.addListener(
      "pushNotificationReceived",
      ({ data }) => {
        if (data?.signal_id) {
          localStorage.setItem("tasknotes.android-smoke.push", data.signal_id);
        }
      }
    );
    globalThis.__tasknotesAndroidPushReceived = received;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("FCM registration timed out.")),
        15000
      );
      Promise.all([
        plugin.addListener("registration", ({ value }) => {
          clearTimeout(timeout);
          resolve(value);
        }),
        plugin.addListener("registrationError", ({ error }) => {
          clearTimeout(timeout);
          reject(new Error(error || "FCM registration failed."));
        })
      ]).then(
        (handles) => {
          globalThis.__tasknotesAndroidPushRegistration = handles;
          return plugin.register();
        },
        reject
      );
    });
  })()`);
  if (skipFcmDelivery) {
    console.warn(
      "Skipping FCM delivery after successful native token registration.",
    );
    return;
  }
  await sendPushNotification(token, signalId);
  await waitFor(
    () =>
      devtools.evaluate(
        `localStorage.getItem("tasknotes.android-smoke.push") === ${JSON.stringify(signalId)}`,
      ),
    "the foreground FCM notification signal",
    20_000,
  );
}

async function sendPushNotification(token, signalId) {
  const accessToken = execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": FIREBASE_PROJECT,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: "Task reminder",
            body: "Open TaskNotes to view your task.",
          },
          data: {
            type: "mdbase.notification",
            version: "1",
            signal_id: signalId,
            criterion_id: "task.reminder",
            cursor: "android-smoke",
          },
          android: {
            priority: "high",
            notification: {
              channel_id: "mdbase-updates",
              tag: "tasknotes-reminders",
            },
          },
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`FCM send failed (${response.status}): ${body}`);
  }
}

async function folderMain() {
  const devices = adb("devices")
    .split("\n")
    .slice(1)
    .filter((line) => line.endsWith("\tdevice"));
  if (devices.length !== 1)
    throw new Error(`Expected one Android device; found ${devices.length}.`);

  const backup = `${FOLDER_COLLECTION}.before-${runId}`;
  const collectionPresent = pathExists(FOLDER_COLLECTION);
  if (collectionPresent) adb("shell", "mv", "--", FOLDER_COLLECTION, backup);
  adb("shell", "mkdir", "-p", FOLDER_COLLECTION);
  adb("shell", "pm", "clear", PACKAGE);
  adb("shell", "am", "force-stop", "com.google.android.documentsui");

  let devtools;
  try {
    launch();
    devtools = await connectToWebView();
    await waitFor(
      () => devtools.hasText("On this device"),
      "the first-run collection choice",
    );
    await devtools.clickButton("On this device");
    await waitFor(
      () => devtools.hasText("Choose an existing folder"),
      "the local folder choice",
    );
    await devtools.clickButton("Choose an existing folder");

    await waitFor(
      () => windowHierarchy().includes("com.google.android.documentsui"),
      "the Android system folder picker",
    );
    await openPickerCollection();
    await tapWindowText("USE THIS FOLDER");
    await waitFor(
      () =>
        windowHierarchy().includes("ALLOW") ||
        windowHierarchy().includes('text="Allow"'),
      "the folder access confirmation",
    );
    await tapWindowText(["ALLOW", "Allow"]);
    await waitFor(
      () => windowHierarchy().includes(`package="${PACKAGE}"`),
      "TaskNotes to resume after folder selection",
    );

    await waitFor(
      () =>
        devtools.evaluate(
          `[...document.querySelectorAll("label")].some((label) => label.innerText.trim() === "New task title")`,
        ),
      "the Today quick capture after selecting a folder",
      20_000,
    ).catch(async (reason) => {
      const text = await devtools.evaluate("document.body?.innerText");
      throw new Error(`${reason.message}\n${text}`);
    });
    const selected = await devtools.evaluate(
      `Capacitor.Plugins.FolderAccess.currentFolder()`,
    );
    if (selected.selection?.name !== "TaskNotesFolderSmoke")
      throw new Error(
        `Unexpected selected folder: ${JSON.stringify(selected.selection)}`,
      );

    const externalTitle = `External folder smoke ${runId}`;
    await devtools.fillInput("New task title", externalTitle);
    await devtools.clickButton("Add", true);
    await waitFor(
      () => sourceForFolderTitle(externalTitle),
      "a Markdown task in the selected folder",
    );

    const benchmarkCount = Number.parseInt(
      process.env.TASKNOTES_FOLDER_BENCHMARK_COUNT ?? "250",
      10,
    );
    const benchmark = await devtools.evaluate(`(async () => {
      const plugin = Capacitor.Plugins.FolderAccess;
      const selectionId = ${JSON.stringify(selected.selection.id)};
      const count = ${benchmarkCount};
      const directory = "tasks/__folder_benchmark__";
      await plugin.ensureDirectory({ selectionId, path: directory });

      const writeStarted = performance.now();
      for (let offset = 0; offset < count; offset += 24) {
        const batch = [];
        for (let index = offset; index < Math.min(offset + 24, count); index += 1) {
          const id = "folder-benchmark-" + String(index).padStart(5, "0");
          batch.push(plugin.writeText({
            selectionId,
            path: directory + "/" + id + ".md",
            data: [
              "---",
              "id: " + id,
              "title: Folder benchmark " + index,
              "status: open",
              "due: 2099-01-01",
              "---",
              "",
              "Android Storage Access Framework benchmark.",
              "",
            ].join("\\n"),
          }));
        }
        await Promise.all(batch);
      }
      const writeMs = performance.now() - writeStarted;

      const listStarted = performance.now();
      const listed = await plugin.listFiles({
        selectionId,
        path: directory,
        extensions: [".md"],
        recursive: true,
      });
      const listMs = performance.now() - listStarted;

      const readStarted = performance.now();
      for (let offset = 0; offset < listed.files.length; offset += 24) {
        await Promise.all(
          listed.files.slice(offset, offset + 24).map(({ path }) =>
            plugin.readText({ selectionId, path })
          ),
        );
      }
      const readMs = performance.now() - readStarted;
      return {
        count: listed.files.length,
        writeMs: Math.round(writeMs),
        listMs: Math.round(listMs),
        readMs: Math.round(readMs),
      };
    })()`);
    if (benchmark.count !== benchmarkCount)
      throw new Error(
        `Expected ${benchmarkCount} benchmark files; found ${benchmark.count}.`,
      );

    console.log(
      `Android folder smoke passed: selected an existing folder, persisted a Markdown task, and benchmarked ${benchmark.count} SAF records (write ${benchmark.writeMs} ms, recursive list ${benchmark.listMs} ms, read ${benchmark.readMs} ms).`,
    );
  } finally {
    if (devtools) devtools.close();
    adb("forward", "--remove", `tcp:${DEVTOOLS_PORT}`);
    adb("shell", "am", "force-stop", PACKAGE);
    adb("shell", "pm", "clear", PACKAGE);
    if (pathExists(FOLDER_COLLECTION))
      adb("shell", "rm", "-r", "--", FOLDER_COLLECTION);
    if (collectionPresent) adb("shell", "mv", "--", backup, FOLDER_COLLECTION);
  }
}

async function openPickerCollection() {
  let hierarchy = windowHierarchy();
  if (!hierarchy.includes('text="TaskNotesFolderSmoke"')) {
    await waitFor(
      () => windowHierarchy().includes('text="Documents"'),
      "Documents in the Android system folder picker",
    );
    await tapWindowText("Documents");
    await waitFor(
      () => windowHierarchy().includes('text="TaskNotesFolderSmoke"'),
      "TaskNotesFolderSmoke in Documents",
    );
  }
  await tapWindowText("TaskNotesFolderSmoke");
  await waitFor(() => {
    hierarchy = windowHierarchy();
    return /text="USE THIS FOLDER"[^>]*enabled="true"/.test(hierarchy);
  }, "TaskNotesFolderSmoke to open in the Android system folder picker");
}

async function tapWindowText(expected) {
  const values = Array.isArray(expected) ? expected : [expected];
  const hierarchy = windowHierarchy();
  for (const tag of hierarchy.matchAll(/<node\b[^>]*>/g)) {
    const attributes = Object.fromEntries(
      [...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    if (
      !values.includes(attributes.text) &&
      !values.includes(attributes["content-desc"])
    )
      continue;
    const bounds = attributes.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;
    const [, left, top, right, bottom] = bounds.map(Number);
    adb(
      "shell",
      "input",
      "tap",
      String(Math.round((left + right) / 2)),
      String(Math.round((top + bottom) / 2)),
    );
    return;
  }
  throw new Error(
    `Could not find ${values.join(" or ")} in the active window.`,
  );
}

function windowHierarchy() {
  adb("shell", "uiautomator", "dump", "/sdcard/tasknotes-folder-smoke.xml");
  return adb("exec-out", "cat", "/sdcard/tasknotes-folder-smoke.xml");
}

function sourceForFolderTitle(title) {
  try {
    return adb("shell", "find", FOLDER_TASKS, "-type", "f", "-name", "*.md")
      .split("\n")
      .filter(Boolean)
      .map((path) => adb("shell", "cat", path))
      .find((source) => source.includes(`title: ${title}`));
  } catch {
    return undefined;
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

  hasEnabledButton(text) {
    return this.evaluate(`
      [...document.querySelectorAll("button")].some(
        (candidate) => candidate.innerText.trim() === ${JSON.stringify(text)} && !candidate.disabled
      )
    `);
  }

  hasEnabledNamedButton(name) {
    return this.evaluate(`
      [...document.querySelectorAll("button")].some(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)} && !candidate.disabled
      )
    `);
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

  async chooseDate(name, value) {
    await this.evaluate(`(() => {
      const trigger = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      if (!trigger) throw new Error("Date picker not found: " + ${JSON.stringify(name)});
      trigger.click();
      return true;
    })()`);
    await this.evaluate(`(() => {
      const date = [...document.querySelectorAll("button[data-date]")].find(
        (candidate) => candidate.dataset.date === ${JSON.stringify(value)}
      );
      if (!date) throw new Error("Date option not found: " + ${JSON.stringify(value)});
      date.click();
      return true;
    })()`);
  }

  async chooseTime(name, value) {
    await this.evaluate(`(() => {
      const trigger = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      if (!trigger || trigger.disabled)
        throw new Error("Time picker not available: " + ${JSON.stringify(name)});
      trigger.click();
      return true;
    })()`);
    const [hour, minute] = value.split(":");
    await this.chooseTimeOption(name, "Hour", hour);
    await this.chooseTimeOption(name, "Minute", minute);
    await this.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      if (!dialog) throw new Error("Time dialog not found: " + ${JSON.stringify(name)});
      const done = [...dialog.querySelectorAll("button")].find(
        (candidate) => candidate.innerText.trim() === "Done"
      );
      if (!done) throw new Error("Time picker Done action not found.");
      done.click();
      return true;
    })()`);
  }

  chooseTimeOption(name, column, value) {
    return this.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(name)}
      );
      const list = [...(dialog?.querySelectorAll('[role="listbox"]') ?? [])].find(
        (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(column)}
      );
      const option = [...(list?.querySelectorAll('[role="option"]') ?? [])].find(
        (candidate) => candidate.innerText.trim() === ${JSON.stringify(value)}
      );
      if (!option)
        throw new Error(${JSON.stringify(column)} + " option not found: " + ${JSON.stringify(value)});
      option.click();
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

  clickSummary(text) {
    return this.evaluate(`(() => {
      const expected = ${JSON.stringify(text)};
      const summary = [...document.querySelectorAll("summary")].find(
        (candidate) =>
          candidate.innerText.trim() === expected ||
          candidate.querySelector("strong")?.innerText.trim() === expected
      );
      if (!summary) throw new Error("Summary not found: " + expected);
      summary.click();
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

if (process.argv.includes("--folder")) await folderMain();
else await main();
