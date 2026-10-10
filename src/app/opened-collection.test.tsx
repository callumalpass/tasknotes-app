import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpenedCollection } from "./opened-collection";
import { useRepository } from "./repository-context";
import { nextTaskFixture } from "../test/next-task-fixture";
import { IndexedDbMutationJournal } from "../storage/application-journal";
import type { TaskRepository } from "../application/ports/task-repository";

// The SDK test replica checks composition and lifetime only, not native READ,
// readiness, authority, grants or actual application rendering.
const observed: TaskRepository[] = [];
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
vi.mock("./app-shell", () => ({
  AppShell: () => {
    const context = useRepository();
    observed.push(context.repository);
    return (
      <>
        <output data-testid="repository-status">{context.status}</output>
        <output data-testid="reminder-authority">
          {context.reminderAuthority}
        </output>
      </>
    );
  },
}));
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  observed.splice(0);
  vi.restoreAllMocks();
});
const callbacks = {
  authorizeAnotherCollection: () => undefined,
  changeCollection: () => undefined,
  reauthorizeCurrentCollection: () => undefined,
  discardPendingRecovery: async () => undefined,
};

it("retains the supplied repository and original client across StrictMode effect replay", async () => {
  const f = await nextTaskFixture();
  fixtures.push(f);
  const close = vi.spyOn(f.client, "close");
  const journalClose = vi.spyOn(IndexedDbMutationJournal.prototype, "close");
  const suspend = vi.spyOn(f.repository, "suspend");
  const mounted = render(
    <StrictMode>
      <OpenedCollection {...callbacks} repository={f.repository} />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("repository-status")).toHaveTextContent("ready"),
  );
  expect(screen.getByTestId("reminder-authority")).toHaveTextContent("none");
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((repository) => repository === f.repository)).toBe(
    true,
  );
  expect(suspend).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(journalClose).not.toHaveBeenCalled();
  const suspensions = suspend.mock.calls.length;
  mounted.unmount();
  expect(suspend).toHaveBeenCalledTimes(suspensions + 1);
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(journalClose).toHaveBeenCalledTimes(1);
});

it("retains the same held repository across a synchronous component remount", async () => {
  const f = await nextTaskFixture();
  fixtures.push(f);
  const close = vi.spyOn(f.client, "close");
  const first = render(
    <OpenedCollection {...callbacks} repository={f.repository} />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("repository-status")).toHaveTextContent("ready"),
  );
  first.unmount();
  const second = render(
    <OpenedCollection {...callbacks} repository={f.repository} />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("repository-status")).toHaveTextContent("ready"),
  );
  expect(close).not.toHaveBeenCalled();
  expect(observed.at(-1)).toBe(f.repository);
  second.unmount();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("remounts for a replacement held repository even when the collection identity is unchanged", async () => {
  const first = await nextTaskFixture();
  const second = await nextTaskFixture();
  fixtures.push(first, second);
  vi.spyOn(second.repository, "collectionInfo").mockImplementation(() =>
    first.repository.collectionInfo(),
  );
  const firstClose = vi.spyOn(first.client, "close");
  const secondClose = vi.spyOn(second.client, "close");
  const mounted = render(
    <OpenedCollection
      key="first-held-lifetime"
      {...callbacks}
      repository={first.repository}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("repository-status")).toHaveTextContent("ready"),
  );
  mounted.rerender(
    <OpenedCollection
      key="replacement-held-lifetime"
      {...callbacks}
      repository={second.repository}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("repository-status")).toHaveTextContent("ready"),
  );
  await waitFor(() => expect(firstClose).toHaveBeenCalledTimes(1));
  expect(observed.at(-1)).toBe(second.repository);
  expect(secondClose).not.toHaveBeenCalled();
  mounted.unmount();
  await waitFor(() => expect(secondClose).toHaveBeenCalledTimes(1));
});
