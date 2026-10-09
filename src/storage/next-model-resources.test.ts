import { MdbaseError, type wire } from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_SETUP_LIMITS } from "../application/ports/model-setup";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  MODEL_RESOURCE_INVENTORY_LIMITS as limits,
  modelResourceInventory,
} from "./next-model-resources";

// Collector protocol tests, not native cursor/currentness/permission witnesses.
function resource(
  path = "mdbase.yaml",
  text = "spec_version: '0.3.0'\n",
): wire.ResourceView {
  return {
    path,
    text,
    revision: `sha256:${"a".repeat(64)}`,
    size: new TextEncoder().encode(text).byteLength,
    state: "confirmed",
  };
}
function reader(...pages: wire.ListResourcesResult[]) {
  const list = vi.fn(async () => {
    const page = pages.shift();
    if (!page) throw Error("unexpected request: collector restarted or looped");
    return page;
  });
  return { resources: { list } };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.restoreAllMocks());

describe("complete bounded model resource inventory", () => {
  it("accepts a complete empty inventory, not an invented resource", async () => {
    const client = reader({ resources: [], complete: true });
    expect(await modelResourceInventory(client, signal())).toEqual([]);
    expect(client.resources.list).toHaveBeenCalledOnce();
  });
  it("collects all pages, asking for text on the same client and original cursor", async () => {
    const a = resource();
    const b = resource("_types/task.md");
    const c = resource("mdbase.lock.yaml");
    const client = reader(
      { resources: [a], complete: false, cursor: "opaque-a" },
      { resources: [b], complete: false, cursor: "opaque-b" },
      { resources: [c], complete: true },
    );
    expect(await modelResourceInventory(client, signal())).toEqual([a, b, c]);
    expect(client.resources.list.mock.calls).toEqual([
      [{ text: true, limit: 128, signal: expect.any(AbortSignal) }],
      [
        {
          text: true,
          limit: 128,
          cursor: "opaque-a",
          signal: expect.any(AbortSignal),
        },
      ],
      [
        {
          text: true,
          limit: 128,
          cursor: "opaque-b",
          signal: expect.any(AbortSignal),
        },
      ],
    ]);
  });
  it("copies captured resources before a subsequent page mutates its containers", async () => {
    const first = resource();
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [first],
        complete: false,
        cursor: "next",
      })
      .mockImplementationOnce(async () => {
        first.text = "changed after capture";
        return { resources: [resource("_types/task.md")], complete: true };
      });
    const result = await modelResourceInventory(
      { resources: { list } },
      signal(),
    );
    expect(result[0]!.text).toBe("spec_version: '0.3.0'\n");
  });
  it.each([
    { resources: [resource()], complete: false },
    { resources: [resource()], complete: false, cursor: "" },
    { resources: [], complete: false, cursor: "next" },
    { resources: [resource()], complete: true, cursor: "next" },
    { resources: [resource()], complete: true, cursor: "" },
  ])(
    "refuses incoherent terminal/continuation shape %# without another request",
    async (page) => {
      const client = reader(page);
      await expect(
        modelResourceInventory(client, signal()),
      ).rejects.toMatchObject({ view: { state: "blocked" } });
      expect(client.resources.list).toHaveBeenCalledOnce();
    },
  );
  it("rejects a repeated continuation rather than replaying the first page", async () => {
    const client = reader(
      { resources: [resource("a")], complete: false, cursor: "same" },
      { resources: [resource("b")], complete: false, cursor: "same" },
    );
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
    expect(client.resources.list).toHaveBeenCalledTimes(2);
  });
  it("rejects a cycle through a previously visited cursor", async () => {
    const client = reader(
      { resources: [resource("a")], complete: false, cursor: "one" },
      { resources: [resource("b")], complete: false, cursor: "two" },
      { resources: [resource("c")], complete: false, cursor: "one" },
    );
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
    expect(client.resources.list).toHaveBeenCalledTimes(3);
  });
  it("rejects duplicate paths across pages, even with identical bytes/revision", async () => {
    const client = reader(
      { resources: [resource()], complete: false, cursor: "next" },
      { resources: [resource()], complete: true },
    );
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
  });
  it.each([
    { ...resource("_types/task.md"), state: "pending" as const },
    { ...resource("_types/task.md"), text: undefined },
    resource(""),
    resource("a".repeat(MODEL_SETUP_LIMITS.pathCodeUnits + 1)),
  ])(
    "refuses an unconfirmed/incomplete/unsupported later resource %#",
    async (bad) => {
      const client = reader(
        { resources: [resource()], complete: false, cursor: "next" },
        { resources: [bad], complete: true },
      );
      await expect(
        modelResourceInventory(client, signal()),
      ).rejects.toMatchObject({ view: { state: "blocked" } });
    },
  );
  it("accepts empty confirmed document text", async () => {
    const client = reader({ resources: [resource("a", "")], complete: true });
    expect((await modelResourceInventory(client, signal()))[0]!.text).toBe("");
  });
  it.each(["invalid_resource_cursor", "cursor_stale", "cursor_expired"])(
    "propagates native %s unchanged without restart or reassessment",
    async (reason) => {
      const error = new MdbaseError({
        code: "invalid_request",
        recovery: "fix_request",
        message: "cursor refused",
        reason,
      });
      const list = vi
        .fn()
        .mockResolvedValueOnce({
          resources: [resource()],
          complete: false,
          cursor: "next",
        })
        .mockRejectedValueOnce(error);
      await expect(
        modelResourceInventory({ resources: { list } }, signal()),
      ).rejects.toBe(error);
      expect(list).toHaveBeenCalledTimes(2);
    },
  );
  it("propagates unavailable inventory rather than treating it as empty", async () => {
    const error = new MdbaseError({
      code: "unavailable",
      recovery: "retry",
      message: "inventory unavailable",
    });
    const list = vi.fn().mockRejectedValueOnce(error);
    await expect(
      modelResourceInventory({ resources: { list } }, signal()),
    ).rejects.toBe(error);
    expect(list).toHaveBeenCalledOnce();
  });
  it("rejects a page larger than the requested/native maximum", async () => {
    const client = reader({
      resources: Array.from({ length: limits.pageSize + 1 }, (_, i) =>
        resource(String(i)),
      ),
      complete: true,
    });
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
  });
  it("bounds the total number of pages without returning the partial inventory", async () => {
    const client = reader(
      ...Array.from({ length: limits.pages }, (_, i) => ({
        resources: [resource(String(i))],
        complete: false,
        cursor: String(i),
      })),
    );
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
    expect(client.resources.list).toHaveBeenCalledTimes(limits.pages);
  });
  it("accepts a terminal page at the page-count bound", async () => {
    const client = reader(
      ...Array.from({ length: limits.pages }, (_, i) =>
        i + 1 === limits.pages
          ? { resources: [resource(String(i))], complete: true }
          : {
              resources: [resource(String(i))],
              complete: false,
              cursor: String(i),
            },
      ),
    );
    expect(await modelResourceInventory(client, signal())).toHaveLength(
      limits.pages,
    );
  });
  it("counts UTF-8 bytes across all pages, not per document/code units", async () => {
    const text = "é".repeat(limits.bytes / 4);
    const client = reader(
      { resources: [resource("a", text)], complete: false, cursor: "next" },
      { resources: [resource("b", text)], complete: true },
    );
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
    expect(client.resources.list).toHaveBeenCalledTimes(2);
  });
  it("accepts exact cumulative byte bound and refuses one more byte", async () => {
    const page = { resources: [resource("a", "")], complete: true };
    const overhead = new TextEncoder().encode(JSON.stringify(page)).byteLength;
    page.resources[0]!.text = "a".repeat(limits.bytes - overhead);
    expect(await modelResourceInventory(reader(page), signal())).toHaveLength(
      1,
    );
    page.resources[0]!.text += "a";
    await expect(
      modelResourceInventory(reader(page), signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
  });
  it("bounds cursor UTF-8 bytes, not code units", async () => {
    const client = reader({
      resources: [resource()],
      complete: false,
      cursor: "é".repeat(limits.cursorBytes / 2 + 1),
    });
    await expect(
      modelResourceInventory(client, signal()),
    ).rejects.toMatchObject({ view: { state: "blocked" } });
    expect(client.resources.list).toHaveBeenCalledOnce();
  });
  it("accepts a cursor exactly at its published UTF-8 bound", async () => {
    const client = reader(
      {
        resources: [resource("a")],
        complete: false,
        cursor: "é".repeat(limits.cursorBytes / 2),
      },
      { resources: [], complete: true },
    );
    expect(await modelResourceInventory(client, signal())).toHaveLength(1);
  });
  it("checks original owner cancellation before requesting", async () => {
    const owner = new AbortController();
    const reason = Error("owner left");
    owner.abort(reason);
    const client = reader({ resources: [], complete: true });
    await expect(modelResourceInventory(client, owner.signal)).rejects.toBe(
      reason,
    );
    expect(client.resources.list).not.toHaveBeenCalled();
  });
  it("does not use a page received after owner cancellation", async () => {
    const owner = new AbortController();
    const reason = Error("owner left");
    const list = vi.fn(async () => {
      owner.abort(reason);
      return { resources: [resource()], complete: false, cursor: "next" };
    });
    await expect(
      modelResourceInventory({ resources: { list } }, owner.signal),
    ).rejects.toBe(reason);
    expect(list).toHaveBeenCalledOnce();
  });
  it("uses the existing foreground budget once for the whole inventory", async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    const reason = Error("whole inventory deadline");
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [resource()],
        complete: false,
        cursor: "next",
      })
      .mockImplementationOnce(async () => {
        deadline.abort(reason);
        return { resources: [], complete: true };
      });
    await expect(
      modelResourceInventory({ resources: { list } }, signal()),
    ).rejects.toBe(reason);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(
      TASKNOTES_REQUEST_BUDGETS.foregroundMs,
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});
