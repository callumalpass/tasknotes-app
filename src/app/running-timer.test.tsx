import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../test/render";
import { afterEach, expect, it, vi } from "vitest";

import { WorkspaceFeedback } from "../components/workspace-feedback";
import { timerCommands } from "./palette-commands";
import { RunningTimerNotice } from "./running-timer";
import { useTimerControl } from "./use-timer-control";

import type { RunningTimer } from "../domain/running-timers";

const fixture = vi.hoisted(() => ({
  timers: [] as { id: string; title: string; startTime: string }[] | null,
  listeners: new Set<() => void>(),
  reads: vi.fn(),
  start: vi.fn<(id: string) => Promise<undefined>>(async () => undefined),
  stop: vi.fn<(id: string) => Promise<undefined>>(async () => undefined),
}));
const repository = {
  runningTimers: () => fixture.timers,
  subscribe(listener: () => void) {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
  listSummaries: fixture.reads,
  stats: fixture.reads,
  executeView: fixture.reads,
};
vi.mock("./repository-context", () => ({
  useRepository: () => ({
    repository,
    status: "ready",
    startTimeTracking: fixture.start,
    stopTimeTracking: fixture.stop,
  }),
}));

afterEach(() => {
  cleanup();
  fixture.timers = [];
  fixture.listeners.clear();
  fixture.reads.mockClear();
  fixture.start.mockReset().mockResolvedValue(undefined);
  fixture.stop.mockReset().mockResolvedValue(undefined);
});

function running(id: string, minutesAgo: number): RunningTimer {
  return {
    id,
    title: `Task ${id}`,
    startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function publish(timers: RunningTimer[] | null) {
  act(() => {
    fixture.timers = timers;
    for (const listener of fixture.listeners) listener();
  });
}

function Harness({ onOpen = vi.fn() }: { onOpen?(id: string): void }) {
  const control = useTimerControl();
  return (
    <WorkspaceFeedback aboveMobileControls={false}>
      <RunningTimerNotice control={control} onOpen={onOpen} />
      <button type="button" onClick={() => void control.start("new", "New")}>
        start
      </button>
    </WorkspaceFeedback>
  );
}

it("stays out of the way until a timer runs, and never starts a read", async () => {
  render(<Harness />);
  expect(screen.queryByRole("group", { name: "Running timer" })).toBeNull();
  publish(null);
  expect(screen.queryByRole("group", { name: "Running timer" })).toBeNull();
  publish([running("a", 75)]);
  const notice = screen.getByRole("group", { name: "Running timer" });
  expect(notice).toHaveTextContent("Task a");
  await waitFor(() => expect(notice).toHaveTextContent("1h 15m"));
  expect(fixture.reads).not.toHaveBeenCalled();
});

it("opens the timed task and stops its timer from the notice", async () => {
  const onOpen = vi.fn();
  render(<Harness onOpen={onOpen} />);
  publish([running("a", 5), running("b", 50)]);
  fireEvent.click(screen.getByRole("button", { name: /^Task a/ }));
  expect(onOpen).toHaveBeenCalledWith("a");
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Stop timer for Task a" }),
    );
  });
  expect(fixture.stop).toHaveBeenCalledWith("a");
  publish([running("b", 50)]);
  expect(
    screen.getByRole("group", { name: "Running timer" }),
  ).toHaveTextContent("Task b");
});

it("says so when a timer could not be stopped or started", async () => {
  fixture.stop.mockRejectedValueOnce(new Error("offline"));
  render(<Harness />);
  publish([running("a", 5)]);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Stop timer for Task a" }),
    );
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn’t stop the timer.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();

  publish([]);
  fixture.start.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "start" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn’t start the timer.",
  );
});

it("offers Start for the palette's task and Stop for whatever is running", () => {
  const row = document.createElement("div");
  row.dataset.taskId = "focused";
  row.dataset.taskTitle = "Focused task";
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const elsewhere = running("elsewhere", 10);

  const commands = timerCommands(row, { timers: [elsewhere], start, stop });
  expect(
    commands.map(({ id, label, detail, section }) => ({
      id,
      label,
      detail,
      section,
    })),
  ).toEqual([
    {
      id: "task:timer",
      label: "Start timer",
      detail: "Focused task",
      section: "task",
    },
    {
      id: "timer:stop:elsewhere",
      label: "Stop timer",
      detail: "Task elsewhere",
      section: "actions",
    },
  ]);
  commands[0]!.run();
  expect(start).toHaveBeenCalledWith("focused", "Focused task");
  commands[1]!.run();
  expect(stop).toHaveBeenCalledWith(elsewhere);

  const own = running("focused", 3);
  expect(
    timerCommands(row, { timers: [own], start, stop }).map(
      ({ id, section }) => ({ id, section }),
    ),
  ).toEqual([{ id: "timer:stop:focused", section: "task" }]);
  expect(timerCommands(null, { timers: [], start, stop })).toEqual([]);
});
