import { MdbaseError } from "@mdbase-dev/sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionAvailability } from "../components/collection-availability";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { defaultCalendarPreferences } from "./calendar-preferences";
import { CollectionGateContext } from "./collection-context";
import { MoreScreen } from "./more-screen";
import {
  RepositoryProvider,
  useRepository,
  useTaskSearch,
} from "./repository-context";

// SDK/component stand-ins only; no actual native browser or LAB qualification.
vi.mock("../native/mdbase-notifications", () => ({
  mdbaseNotifications: {
    status: vi.fn(async () => ({ state: "disabled", optedIn: false })),
  },
}));
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});
const callbacks = {
  authorizeAnotherCollection: () => undefined,
  changeCollection: () => undefined,
  reauthorizeCurrentCollection: () => undefined,
};

it("contains a rejected Settings refresh while showing cached search and retaining Retry connection", async () => {
  const f = await nextTaskFixture({ where: () => false });
  fixtures.push(f);
  await f.repository.create({ title: "Previously loaded task" });
  const describe = vi.mocked(f.client.describe);
  const original = describe.getMockImplementation()!;
  let context!: ReturnType<typeof useRepository>;
  function Probe() {
    context = useRepository();
    const search = useTaskSearch({ search: "Previously" });
    return (
      <>
        <output>{context.status}</output>
        {search.tasks.map((result) => (
          <p key={result.task.id}>{result.task.title}</p>
        ))}
        <CollectionAvailability />
        <MoreScreen
          calendarPreferences={defaultCalendarPreferences()}
          onCalendarPreferencesChange={() => undefined}
        />
      </>
    );
  }
  const mounted = render(
    <CollectionGateContext.Provider value={callbacks}>
      <RepositoryProvider
        repository={f.repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <Probe />
      </RepositoryProvider>
    </CollectionGateContext.Provider>,
  );
  await screen.findByText("Previously loaded task");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeEnabled(),
  );
  describe.mockRejectedValue(
    new MdbaseError({
      code: "unavailable",
      recovery: "retry",
      message: "Offline",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await screen.findByText("Collection unavailable");
  expect(screen.getByText("Previously loaded task")).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Collection connection" }),
  ).toHaveTextContent("Showing previously loaded tasks");
  expect(context.error).toMatchObject({ code: "unavailable" });
  expect(context.status).toBe("ready");
  describe.mockImplementation(original);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" })),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Collection connection" }),
    ).toBeNull(),
  );
  expect(context.error).toBeNull();
  mounted.unmount();
});
