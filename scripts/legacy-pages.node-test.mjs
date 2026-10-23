import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("legacy worker retires caches and redirects installed clients", async () => {
  const events = {};
  const calls = [];
  const source = readFileSync(
    new URL("../legacy-pages/service-worker.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    URL,
    caches: {
      keys: async () => ["legacy-shell", "legacy-data"],
      delete: async (key) => calls.push(key),
    },
    self: {
      addEventListener: (name, handler) => (events[name] = handler),
      skipWaiting: () => calls.push("skipWaiting"),
      registration: { unregister: async () => calls.push("unregister") },
      clients: {
        matchAll: async (options) => {
          assert.equal(options.type, "window");
          return [
            ["/tasknotes-app/", "/"],
            ["/tasknotes-app/notes/abc?q=%2F#entry", "/notes/abc?q=%2F#entry"],
          ].map(([path, target]) => ({
            url: "https://callumalpass.github.io" + path,
            navigate: async (url) => {
              assert.equal(url, "https://app.tasknotes.dev" + target);
              calls.push("navigate");
            },
          }));
        },
      },
    },
  });
  events.install();
  let activation;
  events.activate({ waitUntil: (promise) => (activation = promise) });
  await activation;
  assert.deepEqual(calls, [
    "skipWaiting",
    "legacy-shell",
    "legacy-data",
    "unregister",
    "navigate",
    "navigate",
  ]);
  const html = readFileSync(
    new URL("../legacy-pages/index.html", import.meta.url),
    "utf8",
  );
  assert.ok(html.indexOf("<script>") < html.indexOf('http-equiv="refresh"'));
});
