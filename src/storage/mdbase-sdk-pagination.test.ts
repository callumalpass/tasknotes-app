import { expect, it, vi } from "vitest";
import { MdbaseCollectionClient } from "@mdbase-dev/connect/advanced";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { mdbaseFixture, taskRecord, deferred } from "../test/mdbase-fixture";

it.each(["paused", "in-flight"])(
  "SDK abort releases a %s view cursor exactly once",
  async (mode) => {
    const fixture = mdbaseFixture([taskRecord("one", "One", "r1")]);
    const response = (await fixture.executeView()).result;
    const entered = deferred<void>();
    const settle = deferred<void>();
    const requests = vi.fn();
    const released = vi.fn();
    const client = new MdbaseCollectionClient({
      operation: async <Result>(
        operation: string,
        input: unknown,
      ): Promise<Result> => {
        const request = input as { release_cursor?: string };
        if (operation === "query" && request.release_cursor) {
          released(request.release_cursor);
          return {
            valid: true,
            diagnostics: [],
            result: { results: [], meta: { has_more: false } },
          } as Result;
        }
        if (operation !== "execute_view")
          throw new Error("Unexpected operation");
        requests(input);
        entered.resolve();
        if (mode === "in-flight") await settle.promise;
        return {
          valid: true,
          diagnostics: [],
          result: {
            results: response.results.map(
              ({ effectiveFrontmatter, ...record }) => ({
                ...record,
                effective_frontmatter: effectiveFrontmatter,
              }),
            ),
            meta: {
              total_count: 2,
              has_more: true,
              cursor: "cursor-1",
              view: response.meta.view,
            },
          },
        } as Result;
      },
    });
    fixture.connect.executeViewPages = client.executeViewPages.bind(client);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const [document] = await repository.listViews();
    const pages = repository.iterateView(document.views[0]);
    const iterator = pages[Symbol.asyncIterator]();
    const first = iterator.next();
    // Install rejection handling before an in-flight operation is cancelled.
    const result = first.catch((reason: unknown) => reason);
    await entered.promise;
    if (mode === "paused") expect((await first).value.rows).toHaveLength(1);
    repository.suspend();
    settle.resolve();
    await result;
    // No next()/return() call is needed to release the authority lease.
    await vi.waitFor(() =>
      expect(released).toHaveBeenCalledExactlyOnceWith("cursor-1"),
    );
    await iterator.return?.();
    expect(released).toHaveBeenCalledTimes(1);
    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests.mock.calls[0][0]).toMatchObject({ limit: 200 });
  },
);
