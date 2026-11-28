/**
 * Claim 7: how an old producer's refusal reaches the app. No vendored
 * runtime predates the contract methods, so this renames the three contract
 * methods in outgoing request frames; the real runtime then answers them
 * exactly as a producer without them does (its own `unknown_method`).
 *
 *   pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts old-producer
 */
import { connect, inProcessConnector, type FramePort } from "@mdbase-dev/sdk";
import { test } from "vitest";
import { openReplica, seed, plainTask, show } from "./harness";

const HIDDEN = new Set([
  "query_contract_v1",
  "get_contract_v1",
  "map_contract_write_v1",
]);

function rename(value: unknown, seen: string[]): unknown {
  if (typeof value === "string" && HIDDEN.has(value)) {
    seen.push(value);
    return `${value}_absent`;
  }
  if (value instanceof Map)
    return new Map([...value].map(([k, v]) => [k, rename(v, seen)]));
  if (Array.isArray(value)) return value.map((v) => rename(v, seen));
  return value;
}

test("old producer refusals", async () => {
  const r = await openReplica();
  const [id] = await seed(r.client, [
    { path: "tasks/a.md", frontmatter: plainTask(1) },
  ]);
  const renamed: string[] = [];
  const inner = inProcessConnector(r.runtime);
  const old = await connect({
    app: { name: "old-producer-spike", version: "0" },
    reconnect: false,
    connector: {
      description: "old-producer-shim",
      async open(hello, signal) {
        const opened = await inner.open(hello, signal);
        const port = opened.port;
        const shim = {
          send: (frame: never) => {
            if (process.env.SPIKE_DEBUG)
              console.log("send", show(frame).slice(0, 200));
            return port.send(rename(frame, renamed) as never);
          },
          close: () => port.close(),
          get onframe() {
            return port.onframe;
          },
          set onframe(fn) {
            port.onframe =
              fn &&
              ((f: Parameters<NonNullable<FramePort["onframe"]>>[0]) => {
                if (process.env.SPIKE_DEBUG)
                  console.log("recv", show(f).slice(0, 300));
                fn(f);
              });
          },
          get onclose() {
            return port.onclose;
          },
          set onclose(fn) {
            port.onclose = fn;
          },
        } as FramePort;
        return { ...opened, port: shim };
      },
    },
  });
  const out: Record<string, string> = {};
  const attempt = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      out[label] = "ok";
    } catch (e) {
      const err = e as { code?: string; reason?: string; message: string };
      out[label] = `${err.code}/${err.reason}: ${err.message}`;
    }
  };
  await attempt("queryContract", () =>
    old.queryContract(r.contract, { pageSize: 10 }),
  );
  await attempt("getContract", () => old.getContract(id!, r.contract));
  await attempt("create with contract", () =>
    old.create({
      contract: r.contract,
      path: "tasks/b.md",
      frontmatter: { title: "B", status: "open" },
    }),
  );
  await attempt("update with contract", () =>
    old.update(id!, { contract: r.contract, patch: { priority: "high" } }),
  );
  await attempt("ordinary query (control)", async () => {
    for await (const _ of old.pages({ types: ["task"], limit: 10 })) void _;
  });
  console.log(show({ renamedMethods: [...new Set(renamed)], results: out }, 1));
  await r.close();
});
