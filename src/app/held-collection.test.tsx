import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import type { CollectionUiOptions } from "@mdbase-dev/ui/collections";

const created = vi.hoisted(() => ({ repositories: [] as unknown[] }));

vi.mock("../storage/next-repository", () => ({
  NextTaskRepository: class {
    readonly records: unknown;
    constructor(records: unknown) {
      this.records = records;
      created.repositories.push(this);
    }
    dispose() {}
  },
}));
vi.mock("../observability/startup-timing", () => ({
  registerStartupTiming: () => undefined,
}));
vi.mock("./connection-notice", async (original) => ({
  ...(await original<typeof import("./connection-notice")>()),
  useConnectionNotice: () => null,
}));

import { ReadyCollection } from "./held-collection";
import type { StarterViewArming } from "./starter-view-arming";

function connection(records: string): MdbaseApplicationConnection {
  return Object.freeze({
    id: "collection-1",
    generation: "generation-1",
    displayName: "Tasks",
    scope: { account: "a", collection: "collection-1", installation: "i" },
    records,
    isCurrent: () => true,
  }) as unknown as MdbaseApplicationConnection;
}

const ui = {
  mdbase: { subscribe: () => () => {}, getSnapshot: () => ({}) },
  app: {},
} as unknown as CollectionUiOptions;

function Workspace({ repository }: { repository: unknown }) {
  return <main>{(repository as { records: string }).records}</main>;
}

beforeEach(() => {
  created.repositories.length = 0;
});

it("keeps the workspace for the same connection and restarts it for a new one in the same generation", () => {
  const arming = {
    subscribe: () => () => {},
    getArmed: () => null,
    take: () => false,
  } as unknown as StarterViewArming;
  const first = connection("first ports");
  const view = render(
    <ReadyCollection
      arming={arming}
      connection={first}
      ui={ui}
      Workspace={Workspace as never}
    />,
  );
  expect(screen.getByText("first ports")).toBeTruthy();

  view.rerender(
    <ReadyCollection
      arming={arming}
      connection={first}
      ui={ui}
      Workspace={Workspace as never}
    />,
  );
  expect(created.repositories).toHaveLength(1);

  // An approval that grants reminders hands new ports onto the same replica:
  // a new connection object, same generation. The old ports are closed.
  view.rerender(
    <ReadyCollection
      arming={arming}
      connection={connection("renewed ports")}
      ui={ui}
      Workspace={Workspace as never}
    />,
  );
  expect(created.repositories).toHaveLength(2);
  expect(screen.getByText("renewed ports")).toBeTruthy();
});
