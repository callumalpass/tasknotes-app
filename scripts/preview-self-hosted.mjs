import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:tls";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { preview } from "vite";

export async function previewDirect({
  outDir,
  root,
  uiPort = 14917,
  daemonPort = 14918,
  backendPort = 14919,
  observeStatic,
  sdkCode,
}) {
  const uiHost = "127.0.0.1";
  const backendHost = "127.0.0.2";
  for (const port of [uiPort, daemonPort, backendPort]) {
    assert(
      Number.isInteger(port) && port > 0 && port <= 65535,
      "Invalid loopback port",
    );
  }
  const certFile = join(root, "preview.crt");
  const keyFile = join(root, "preview.key");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Disposable direct preview",
      "-addext",
      `subjectAltName=IP:${uiHost},IP:${backendHost}`,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  const https = {
    key: await readFile(keyFile),
    cert: await readFile(certFile),
  };
  const pin = createHash("sha256")
    .update(
      new X509Certificate(https.cert).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
  // Serve the actual direct distribution's single all-path header rule.
  const [scope, ...lines] = (await readFile(join(outDir, "_headers"), "utf8"))
    .trimEnd()
    .split(/\r?\n/);
  assert.equal(scope, "/*");
  const headers = Object.fromEntries(
    lines.map((line) => {
      const pair = /^\s+([^:]+):\s*(.+)$/.exec(line);
      assert(pair);
      return [pair[1], pair[2]];
    }),
  );
  const ui = await preview({
    configFile: false,
    logLevel: "silent",
    build: { outDir: resolve(outDir) },
    preview: {
      host: uiHost,
      port: uiPort,
      strictPort: true,
      https,
      headers,
      proxy: {},
    },
    plugins: [
      {
        name: "direct-proof-observer",
        configurePreviewServer(server) {
          server.httpServer.on("upgrade", (request, socket) => {
            observeStatic?.(request, true);
            socket.destroy();
          });
          server.middlewares.use((request, response, next) => {
            observeStatic?.(request, false);
            if (
              sdkCode &&
              request.url === "/__proof-sdk.js" &&
              request.method === "GET"
            ) {
              response
                .writeHead(200, { "Content-Type": "text/javascript" })
                .end(sdkCode);
            } else if (
              sdkCode &&
              request.url === "/__proof-previous-worker.js"
            ) {
              response
                .writeHead(200, { "Content-Type": "text/javascript" })
                .end("");
            } else next();
          });
        },
      },
    ],
  });
  const sockets = new Set();
  const proxy = createServer(https, (browser) => {
    const upstream = connect(daemonPort, uiHost);
    browser.on("error", () => upstream.destroy());
    upstream.on("error", () => browser.destroy());
    browser.on("close", () => upstream.destroy());
    upstream.on("close", () => browser.destroy());
    browser.pipe(upstream).pipe(browser);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  try {
    proxy.listen(backendPort, backendHost);
    await once(proxy, "listening");
  } catch (error) {
    await ui.close();
    throw error;
  }
  return {
    origin: `https://${uiHost}:${uiPort}`,
    backend: `https://${backendHost}:${backendPort}`,
    listen: `${uiHost}:${daemonPort}`,
    chromiumArgs: [
      `--ignore-certificate-errors-spki-list=${pin}`,
      `--proxy-server=http://${backendHost}:${backendPort}`,
      `--proxy-bypass-list=<-loopback>;${uiHost}:${uiPort};${backendHost}:${backendPort}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${uiHost}, EXCLUDE ${backendHost}`,
      "--disable-background-networking",
      "--disable-quic",
    ],
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([ui.close(), new Promise((done) => proxy.close(done))]);
    },
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { values } = parseArgs({
    options: {
      dist: { type: "string", default: "out/self-hosted" },
      "ui-port": { type: "string", default: "14917" },
      "backend-port": { type: "string", default: "14919" },
      "daemon-port": { type: "string", default: "14918" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/preview-self-hosted.mjs [--dist DIR] [--ui-port PORT] [--backend-port PORT] [--daemon-port PORT]",
    );
  } else {
    const root = await mkdtemp(
      join(tmpdir(), "tasknotes-self-hosted-preview-"),
    );
    let preview;
    try {
      preview = await previewDirect({
        outDir: values.dist,
        root,
        uiPort: Number(values["ui-port"]),
        backendPort: Number(values["backend-port"]),
        daemonPort: Number(values["daemon-port"]),
      });
      console.log(
        `UI: ${preview.origin}\nBackend address for pairing: ${preview.backend}\nDaemon: mdbase self-host --collection DIR --auth-dir AUTH_DIR --origin ${preview.origin} serve --listen ${preview.listen}`,
      );
      console.log(
        `Open a disposable Chromium profile:\nchromium --user-data-dir='${join(root, "chromium")}' ${preview.chromiumArgs.map((arg) => `'${arg}'`).join(" ")} '${preview.origin}'`,
      );
      console.log(
        "Close Chromium, then Ctrl-C here to remove the certificate and disposable profile.",
      );
      await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
    } finally {
      await preview?.close();
      await rm(root, { recursive: true, force: true });
    }
  }
}
