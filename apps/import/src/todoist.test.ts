import { it, expect, vi } from "vitest";
import { TodoistApi } from "./todoist";
import { exampleSource } from "./example";
it("loads all cursor pages, validating external responses and read-only requests", async () => {
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toEqual({ Authorization: "Bearer private-token" });
      const url = new URL(String(input));
      if (url.pathname.endsWith("/user"))
        return Response.json({ id: "account" });
      if (url.pathname.endsWith("/tasks"))
        return Response.json(
          url.searchParams.has("cursor")
            ? { results: [exampleSource.tasks[1]], next_cursor: null }
            : { results: [exampleSource.tasks[0]], next_cursor: "next" },
        );
      return Response.json({ results: [], next_cursor: null });
    },
  );
  const source = await new TodoistApi("private-token", request).load();
  expect(source.tasks).toHaveLength(2);
  expect(source.userId).toBe("account");
  expect(request).toHaveBeenCalledTimes(5);
});
it("rejects repeated cursors rather than looping or creating duplicate tasks", async () => {
  const request = vi.fn(async (input: RequestInfo | URL) =>
    Response.json(
      String(input).endsWith("/user")
        ? { id: "account" }
        : { results: [], next_cursor: "repeat" },
    ),
  );
  await expect(new TodoistApi("token", request).load()).rejects.toThrow(
    "repeated pagination",
  );
});
it("does not include provider response bodies or tokens in errors", async () => {
  const request = vi.fn(
    async () => new Response("sensitive provider response", { status: 401 }),
  );
  await expect(new TodoistApi("secret", request).load()).rejects.toThrow(
    "session expired",
  );
});
it.each([429, 500, 503])(
  "refuses HTTP %i without exposing payloads or retrying",
  async (status) => {
    const request = vi.fn(
      async () =>
        new Response("[test] private source payload", {
          status,
          headers: { "Retry-After": "17" },
        }),
    );
    const failure = await new TodoistApi("[test] private token", request)
      .load()
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("private source payload");
    expect(String(failure)).not.toContain("private token");
    expect(String(failure)).toContain(status === 429 ? "17" : String(status));
    expect(request).toHaveBeenCalledTimes(1);
  },
);
it("rejects duplicate task identities across different source pages", async () => {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/user"))
      return Response.json({ id: "[test] account" });
    if (url.pathname.endsWith("/tasks"))
      return Response.json({
        results: [exampleSource.tasks[0]],
        next_cursor: url.searchParams.has("cursor") ? null : "second-page",
      });
    return Response.json({ results: [], next_cursor: null });
  });
  await expect(new TodoistApi("[test] token", request).load()).rejects.toThrow(
    "duplicate task IDs",
  );
});
it("rejects an invalid task on a later page rather than returning a partial source", async () => {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/user"))
      return Response.json({ id: "[test] account" });
    if (url.pathname.endsWith("/tasks"))
      return Response.json({
        results: url.searchParams.has("cursor")
          ? [{ ...exampleSource.tasks[0], priority: 9 }]
          : [exampleSource.tasks[0]],
        next_cursor: url.searchParams.has("cursor") ? null : "second-page",
      });
    return Response.json({ results: [], next_cursor: null });
  });
  await expect(
    new TodoistApi("[test] token", request).load(),
  ).rejects.toThrow();
});
it("forwards cancellation to every in-flight source request", async () => {
  const cancel = new AbortController();
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(cancel.signal);
      if (String(input).endsWith("/user"))
        return Response.json({ id: "[test] account" });
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(init!.signal!.reason),
        );
      });
    },
  );
  const loading = new TodoistApi("[test] token", request).load(cancel.signal);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
  cancel.abort();
  await expect(loading).rejects.toMatchObject({ name: "AbortError" });
});
