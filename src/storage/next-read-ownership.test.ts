import { afterEach, expect, it, vi } from "vitest";
import { wire, type FramePort } from "@mdbase-dev/sdk";
import {
  appLocalConnector,
  attachAppLocalFacade,
} from "@mdbase-dev/sdk/app-host";
import { nextTaskFixture } from "../test/next-task-fixture";
import type { TaskView } from "../domain/view";

// One actual SDK UI client, actual public facade/MessageChannel and ordinary
// describe RPC cancellation. Catalog and MemoryReplica are protocol stand-ins,
// not native Core, account, durability or physical-drain qualification.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["superseded", "cancelled", "unavailable"] as const)(
  "isolates a %s describe owner without hiding a current native refusal",
  async (outcome) => {
    const bytes = structuredClone(Uint8Array.of(0));
    vi.stubGlobal("Uint8Array", bytes.constructor);
    vi.stubGlobal("ArrayBuffer", bytes.buffer.constructor);
    let holdDescribe = false;
    let describeCount = 0;
    const held: (() => void)[] = [];
    let closeFacade = () => {};
    const f = await nextTaskFixture(
      { confirmDelayMs: null },
      false,
      undefined,
      (replica, catalog) => ({
        description: "actual public facade with declared native stand-in",
        async open(hello, signal) {
          const backing = await replica.connector().open(hello, signal);
          const channel = new MessageChannel();
          const native: FramePort = {
            onframe: null,
            onclose: null,
            send(raw) {
              const frame = wire.clientFrame.dec(raw);
              if (frame.kind === "request" && frame.method === "hello") {
                native.onframe?.(backing.helloResponse);
              } else if (
                frame.kind === "request" &&
                frame.method === "describe"
              ) {
                describeCount++;
                const result = () =>
                  native.onframe?.(
                    wire.clientFrame.enc({
                      kind: "response",
                      id: frame.id,
                      result: wire.describeResult.enc(catalog),
                    }),
                  );
                if (holdDescribe) {
                  holdDescribe = false;
                  held.push(
                    outcome === "superseded"
                      ? result
                      : () =>
                          native.onframe?.(
                            wire.clientFrame.enc({
                              kind: "response",
                              id: frame.id,
                              problem: {
                                code: outcome,
                                recovery: "retry",
                                message: "Native catalog refusal",
                              },
                            }),
                          ),
                  );
                } else queueMicrotask(result);
              } else backing.port.send(raw);
            },
            close() {
              backing.port.close();
            },
          };
          backing.port.onframe = (raw) => native.onframe?.(raw);
          backing.port.onclose = (error) => native.onclose?.(error);
          const scope = {
            account: "11111111-1111-4111-8111-111111111111",
            installation: "22222222-2222-4222-8222-222222222222",
            collection: replica.collection,
            isCurrent: () => true,
          };
          const attached = attachAppLocalFacade(
            { connect: () => native },
            channel.port1,
            scope,
          );
          closeFacade = () => {
            attached.close();
            channel.port1.close();
            channel.port2.close();
          };
          return appLocalConnector(channel.port2, scope).open(hello, signal);
        },
      }),
    );
    try {
      const task = await f.repository.create({ title: "Original task" });
      vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
        kind: "success",
        views: [],
        continuation: null,
        clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
        collectionRevision: "sha256:" + "ab".repeat(32),
      });
      holdDescribe = true;
      const owner = new AbortController();
      const view: TaskView = {
        key: "today",
        id: "today",
        name: "Today",
        documentId: "views",
        documentName: "Views",
        properties: [],
        sort: [],
        source: {
          path: "views.base",
          format: "obsidian.base",
          revision: "one",
          writable: true,
        },
        presentation: {
          type: "tasknotes.task-list",
          mappings: {},
          options: {},
        },
      };
      const stream = f.repository.iterateView(view, { signal: owner.signal });
      const obsolete = stream[Symbol.asyncIterator]()
        .next()
        .catch((reason: unknown) => reason);
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const countBefore = describeCount;
      const observed = vi.spyOn(AbortSignal.prototype, "addEventListener");
      const navigation = f.repository.listViews();
      const detail = f.repository.get(task.id);
      // Both observeChanges calls install their original-owner cancellation
      // listener before entering the held model read. No timing sleeps.
      await vi.waitFor(() =>
        expect(
          observed.mock.calls.filter(([type]) => type === "abort"),
        ).toHaveLength(2),
      );
      observed.mockRestore();
      if (outcome === "superseded") owner.abort();
      else held.shift()!();
      const results = await Promise.allSettled([navigation, detail]);
      if (outcome === "superseded") {
        expect(await obsolete).toMatchObject({ name: "AbortError" });
        expect(results).toEqual([
          { status: "fulfilled", value: [] },
          { status: "fulfilled", value: task },
        ]);
        expect(describeCount).toBe(countBefore + 1);
      } else {
        expect(await obsolete).toMatchObject({
          code: outcome,
          message: "Native catalog refusal",
        });
        expect(results).toMatchObject([
          {
            status: "rejected",
            reason: { code: outcome, message: "Native catalog refusal" },
          },
          {
            status: "rejected",
            reason: { code: outcome, message: "Native catalog refusal" },
          },
        ]);
        expect(owner.signal.aborted).toBe(false);
        expect(describeCount).toBe(countBefore);
      }
      expect(f.replica.allRecords).toHaveLength(1);
      expect(f.client.hello.collection).toBe(f.replica.collection);
      expect(f.replica.sessionCount).toBe(1);
    } finally {
      held.splice(0).forEach((reply) => reply());
      f.close();
      closeFacade();
    }
  },
);
