import {
  captureTodoistReturn,
  clearTodoistReturn,
  todoistReturn,
} from "./todoist-return";
const fixture = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./todoist-authorization", () => ({ loadTodoistReturn: fixture.load }));

beforeEach(() => {
  fixture.load.mockReset();
});

afterEach(() => {
  clearTodoistReturn();
  history.replaceState(null, "", "/");
});

it("clears authorization parameters before app startup and exchanges only once", async () => {
  const source = { userId: "synthetic", tasks: [], projects: [], sections: [] };
  fixture.load.mockResolvedValue(source);
  history.replaceState(
    null,
    "",
    "/import/todoist/callback?state=state&code=secret",
  );
  const callback = new URL(location.href);
  captureTodoistReturn(callback);
  expect(location.pathname).toBe("/import");
  expect(location.search).toBe("");
  expect(await todoistReturn()).toEqual({ source });
  expect(await todoistReturn()).toEqual({ source });
  expect(fixture.load).toHaveBeenCalledTimes(1);
  expect(fixture.load).toHaveBeenCalledWith(callback);
});

it("retains callback failure for the import route without leaking callback parameters", async () => {
  fixture.load.mockRejectedValue(new Error("declined"));
  history.replaceState(
    null,
    "",
    "/import/todoist/callback?error=access_denied&state=secret",
  );
  captureTodoistReturn(new URL(location.href));
  expect(await todoistReturn()).toEqual({
    error: expect.objectContaining({ message: "declined" }),
  });
  expect(location.pathname + location.search).toBe("/import");
});

it("leaves the main app's mdbase callback untouched", async () => {
  history.replaceState(null, "", "/auth/mdbase/callback?code=original");
  captureTodoistReturn(new URL(location.href));
  expect(location.pathname + location.search).toBe(
    "/auth/mdbase/callback?code=original",
  );
  expect(await todoistReturn()).toBeUndefined();
  expect(fixture.load).not.toHaveBeenCalled();
});
