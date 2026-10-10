import {
  StartupTiming,
  registerStartupTiming,
  startupTiming,
  timedStartup,
} from "./startup-timing";
let clock: number;
let mark: ReturnType<typeof vi.fn>;
let measure: ReturnType<typeof vi.fn>;
let debug: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clock = 0;
  mark = vi.fn();
  measure = vi.fn();
  vi.stubGlobal("performance", { now: () => clock, mark, measure });
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("marks/measures monotonic durations and reports once only after genuine query and render", () => {
  const trace = new StartupTiming({ bootstrap: 8 });
  const query = trace.begin("first_query");
  clock = 12.24;
  query();
  const render = trace.begin("first_render");
  trace.report();
  expect(debug).not.toHaveBeenCalled();
  clock = 16.3;
  render();
  trace.report();
  trace.report();
  query();
  expect(trace.snapshot()).toEqual({
    bootstrap: 8,
    first_query: 12.2,
    first_render: 4.1,
  });
  expect(mark).toHaveBeenCalledTimes(4);
  expect(measure).toHaveBeenCalledTimes(2);
  expect(debug).toHaveBeenCalledTimes(1);
  expect(JSON.parse(debug.mock.calls[0]![1] as string)).toEqual(
    trace.snapshot(),
  );
});
it("keeps only bounded own host durations, never IDs, errors, invented UI evidence or getters", () => {
  const getter = vi.fn(() => {
    throw Error("secret");
  });
  const seed = Object.assign(Object.create({ bootstrap: 999 }), {
    native_open: 4,
    sql_open: Infinity,
    verified_read: -1,
    first_query: 9,
    first_render: 1,
    account: "secret",
    scope: "secret",
  });
  Object.defineProperty(seed, "bootstrap", { get: getter });
  const trace = new StartupTiming(seed);
  expect(getter).not.toHaveBeenCalled();
  expect(trace.snapshot()).toEqual({ native_open: 4 });
  trace.report();
  expect(debug).not.toHaveBeenCalled();
});
it("fences old stage callbacks and keeps the first settled measurement immutable", () => {
  const trace = new StartupTiming();
  const old = trace.begin("first_query");
  clock = 20;
  const current = trace.begin("first_query");
  clock = 25;
  old();
  expect(trace.snapshot()).toEqual({});
  current();
  clock = 40;
  trace.begin("first_query")();
  expect(trace.snapshot()).toEqual({ first_query: 5 });
});
it("associates traces only with their original repository", async () => {
  const a = {},
    b = {};
  const trace = registerStartupTiming(a);
  expect(startupTiming(b)).toBeUndefined();
  const value = await timedStartup(a, "setup_assessment", async () => {
    clock = 7;
    return "ready";
  });
  expect(value).toBe("ready");
  expect(trace.snapshot()).toEqual({ setup_assessment: 7 });
});
it("never masks success, rejection or an original abort when timing APIs fail", async () => {
  const repository = {};
  registerStartupTiming(repository);
  mark.mockImplementation(() => {
    throw Error("unsupported");
  });
  const reason = Error("original abort");
  await expect(
    timedStartup(repository, "setup_assessment", async () => {
      throw reason;
    }),
  ).rejects.toBe(reason);
  await expect(
    timedStartup(repository, "repository_init", async () => 42),
  ).resolves.toBe(42);
  expect(debug).not.toHaveBeenCalled();
});
it("ignores logging failures without repeating or changing the result", () => {
  const trace = new StartupTiming();
  trace.begin("first_query")();
  trace.begin("first_render")();
  debug.mockImplementation(() => {
    throw Error("unavailable console");
  });
  expect(() => trace.report()).not.toThrow();
  trace.report();
  expect(debug).toHaveBeenCalledTimes(1);
});
