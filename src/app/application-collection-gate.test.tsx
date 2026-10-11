import { StrictMode, useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MdbasePeopleClient,
  type MdbaseApplicationSnapshot,
  type MdbaseApplicationConnection,
} from "@mdbase-dev/sdk";
import { createApplicationFixture } from "@mdbase-dev/sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { taskNotesApplicationDeclaration } from "../cloud/tasknotes-application";
import { nextTaskFixture } from "../test/next-task-fixture";
import {
  ApplicationCollectionGate,
  type ApplicationPickerProps,
} from "./application-collection-gate";
import type { OpenedCollection } from "./opened-collection";
import type { TaskRepository } from "../application/ports/task-repository";

// Public SDK UI fixture + original MemoryReplica clients. Not registration,
// native custody/drain, manifest binding or LAB evidence.
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach((close) => close()));
const declaration = taskNotesApplicationDeclaration({
  environment: "lab",
  appOrigin: "http://127.0.0.1:48218",
});
const emptyFacet = { checking: false, assessment: null, problem: null };
function initial(): MdbaseApplicationSnapshot {
  return {
    status: "signed_out",
    signIn: null,
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
    readiness: {
      ...emptyFacet,
      facets: {
        capabilities: emptyFacet,
        contracts: emptyFacet,
        configuration: emptyFacet,
        files: emptyFacet,
        people: emptyFacet,
        notifications: emptyFacet,
      },
    },
    selection: {
      state: "none",
      requested: {
        collectionId: null,
        source: "none",
        displayName: null,
        approved: false,
      },
      usable: null,
      problem: null,
    },
  };
}
function Picker(props: ApplicationPickerProps) {
  return (
    <section role="dialog" aria-label="Collections">
      {props.connections.map((item) => (
        <button
          key={item.collectionId}
          onClick={() => props.onSelect(item.collectionId)}
        >
          Pick {item.displayName}
        </button>
      ))}
      <button onClick={props.onClose}>Cancel picker</button>
      <p>Usable: {props.selectedCollectionId}</p>
    </section>
  );
}
function Workspace(props: Parameters<typeof OpenedCollection>[0]) {
  return (
    <main>
      <p>Original workspace</p>
      <button onClick={props.changeCollection}>Change collection</button>
      <button onClick={props.reauthorizeCurrentCollection}>
        Reapprove current
      </button>
    </main>
  );
}
async function fixture() {
  const native = await nextTaskFixture();
  closes.push(native.close);
  const connection: MdbaseApplicationConnection = {
    id: native.client.hello.collection,
    displayName: "Original tasks",
    generation: "original-generation",
    scope: {
      account: native.accountId,
      installation: crypto.randomUUID(),
      collection: native.client.hello.collection,
    },
    records: native.client,
    files: native.client.files,
    people: new MdbasePeopleClient(native.client, {
      collection: native.client.hello.collection,
      isCurrent: () => true,
      request: async () => {
        throw new Error("No metadata authority in this fixture");
      },
    }),
    isCurrent: () => true,
  };
  const sdk = createApplicationFixture({
    declaration,
    connections: [connection],
    initialSnapshot: initial(),
  });
  closes.push(sdk.controls.close);
  const ready = (): MdbaseApplicationSnapshot => ({
    ...initial(),
    status: "ready",
    selectedCollectionId: connection.id,
    collections: [
      {
        collectionId: connection.id,
        displayName: connection.displayName,
        role: "owner",
      },
    ],
    readiness: {
      ...initial().readiness,
      assessment: { status: "ready", problem: null },
    },
    selection: {
      state: "usable",
      requested: {
        collectionId: connection.id,
        displayName: connection.displayName,
        source: "user",
        approved: true,
      },
      usable: {
        collectionId: connection.id,
        displayName: connection.displayName,
        role: "owner",
      },
      problem: null,
    },
  });
  return { native, connection, sdk, ready };
}

it("retains one public owner through StrictMode replay and delegates approval synchronously", async () => {
  const f = await fixture();
  let reserved = false;
  f.sdk.controls.setHandler("approve", () => {
    reserved = true;
  });
  const view = render(
    <StrictMode>
      <ApplicationCollectionGate
        entry={f.sdk.entry}
        Picker={Picker}
        Workspace={Workspace}
      />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .filter((call) => call.action === "start"),
    ).toHaveLength(1),
  );
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "close"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(reserved).toBe(true);
  expect(
    f.sdk.controls
      .observedActions()
      .filter((call) => call.action === "approve"),
  ).toHaveLength(1);
  view.unmount();
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .filter((call) => call.action === "close"),
    ).toHaveLength(1),
  );
});

it("keeps an unknown request for approval without silently selecting the approved collection", async () => {
  const f = await fixture();
  const value = {
    ...f.ready(),
    status: "unselected" as const,
    selectedCollectionId: null,
    selection: {
      ...initial().selection,
      state: "approval_required" as const,
      requested: {
        collectionId: "unknown-request",
        displayName: null,
        source: "url" as const,
        approved: false,
      },
    },
  };
  f.sdk.controls.publishSnapshot(value);
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Approve requested collection" }),
  ).toBeEnabled();
  expect(screen.queryByText("Original workspace")).not.toBeInTheDocument();
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "select"),
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Approve requested collection" }),
  );
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .filter((call) => call.action === "approve"),
    ).toHaveLength(1),
  );
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "select"),
  ).toBe(false);
});

it("borrows the original client and preserves route/workspace on pre-selection Cancel", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot(f.ready());
  let held: TaskRepository | undefined;
  const Probe = (props: Parameters<typeof OpenedCollection>[0]) => {
    useEffect(() => {
      held = props.repository;
    }, [props.repository]);
    return <Workspace {...props} />;
  };
  window.history.replaceState(null, "", "/task/original?collection=kept");
  const route = window.location.href;
  const close = vi.spyOn(f.native.client, "close");
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Probe}
    />,
  );
  await screen.findByText("Original workspace");
  const original = held;
  fireEvent.click(screen.getByRole("button", { name: "Change collection" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel picker" }));
  expect(held).toBe(original);
  expect(screen.getByText("Original workspace")).toBeVisible();
  expect(window.location.href).toBe(route);
  expect(
    f.sdk.controls
      .observedActions()
      .some((call) =>
        ["select", "chooseAnother", "clearSelection"].includes(call.action),
      ),
  ).toBe(false);
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reapprove current" }));
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .some((call) => call.action === "reauthorize"),
    ).toBe(true),
  );
  act(() => f.sdk.controls.publishSnapshot(initial()));
  await screen.findByRole("button", { name: "Sign in" });
  expect(close).not.toHaveBeenCalled();
  close.mockRestore();
});

function paired(f: Awaited<ReturnType<typeof fixture>>) {
  const id = f.connection.id;
  return {
    requestId: id,
    installationId: f.connection.scope.installation,
    deviceId: id,
    appId: declaration.id,
    kind: "app-runtime" as const,
    verificationUri: `https://connect-lab.mdbase.dev/pair/${id}`,
    state: "paired" as const,
    accountId: f.connection.scope.account,
    collectionIds: [id],
    createCollections: false,
    requestedCreateCollections: true,
  };
}

it.each([
  ["blocked", "outcome_unknown"],
  ["unselected", "unavailable"],
] as const)(
  "requires an explicit original-target Retry for %s/%s, with no popup or replay",
  async (status, problem) => {
    const f = await fixture();
    f.sdk.controls.publishSnapshot({
      ...f.ready(),
      status,
      problem,
      signIn: paired(f),
      selection: { ...f.ready().selection, state: "blocked", usable: null },
    });
    let finish!: () => void;
    f.sdk.controls.setHandler(
      "select",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ApplicationCollectionGate
        entry={f.sdk.entry}
        Picker={Picker}
        Workspace={Workspace}
      />,
    );
    const retry = await screen.findByRole("button", { name: /^Retry$/ });
    expect(
      f.sdk.controls.observedActions().some((call) => call.action === "select"),
    ).toBe(false);
    fireEvent.click(retry);
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    const calls = f.sdk.controls
      .observedActions()
      .filter((call) => call.action === "select");
    expect(calls).toHaveLength(1);
    expect(calls[0].collectionId).toBe(f.connection.id);
    expect(calls[0].signal).toBeDefined();
    expect(
      f.sdk.controls
        .observedActions()
        .some((call) =>
          ["approve", "authorize", "reauthorize", "chooseAnother"].includes(
            call.action,
          ),
        ),
    ).toBe(false);
    await act(async () => finish());
    expect(retry).toBeEnabled();
  },
);

it("shows a genuine Retry refusal rather than hiding it behind the earlier recovery message", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot({
    ...f.ready(),
    status: "blocked",
    problem: "outcome_unknown",
    signIn: paired(f),
    selection: { ...f.ready().selection, state: "blocked", usable: null },
  });
  f.sdk.controls.setHandler("select", () => {
    throw Object.assign(new Error("private-refusal-details"), {
      code: "application_registration_binding",
    });
  });
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Retry$/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "does not match TaskNotes' registered application",
    ),
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "private-refusal-details",
  );
  expect(
    f.sdk.controls.observedActions().filter((call) => call.action === "select"),
  ).toHaveLength(1);
});

it.each(["recovery_required", "refused", "fenced"])(
  "does not retry terminal %s on the public entry",
  async (problem) => {
    const f = await fixture();
    f.sdk.controls.publishSnapshot({
      ...f.ready(),
      status: "blocked",
      problem,
      signIn: paired(f),
      selection: { ...f.ready().selection, state: "blocked", usable: null },
    });
    render(
      <ApplicationCollectionGate
        entry={f.sdk.entry}
        Picker={Picker}
        Workspace={Workspace}
      />,
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /^Retry$/ }),
    ).not.toBeInTheDocument();
    expect(
      f.sdk.controls.observedActions().some((call) => call.action === "select"),
    ).toBe(false);
  },
);

it("does not retarget an old workspace action after its original SDK scope retires", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot(f.ready());
  let oldAction: (() => void) | undefined;
  const Probe = (props: Parameters<typeof OpenedCollection>[0]) => {
    useEffect(() => {
      oldAction = props.reauthorizeCurrentCollection;
    }, [props.reauthorizeCurrentCollection]);
    return <Workspace {...props} />;
  };
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Probe}
    />,
  );
  await screen.findByText("Original workspace");
  act(() => f.sdk.controls.publishSnapshot(initial()));
  await screen.findByRole("button", { name: "Sign in" });
  await act(async () => oldAction?.());
  expect(
    f.sdk.controls
      .observedActions()
      .some((call) => call.action === "reauthorize"),
  ).toBe(false);
  expect(screen.getByRole("alert")).toHaveTextContent("no longer current");
});

it("keeps a current workspace while visibly reporting an SDK reapproval refusal", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot(f.ready());
  f.sdk.controls.setHandler("reauthorize", () => {
    throw Object.assign(new Error("private-popup-details"), {
      reason: "popup_blocked",
    });
  });
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Reapprove current" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your browser blocked the sign-in window.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "private-popup-details",
  );
  expect(screen.getByText("Original workspace")).toBeVisible();
  expect(
    f.sdk.controls
      .observedActions()
      .filter((call) => call.action === "reauthorize"),
  ).toHaveLength(1);
});

it("delegates intentional chooseAnother without treating picker dismissal as retirement", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot({
    ...initial(),
    status: "unselected",
    selection: {
      ...initial().selection,
      state: "invalid",
      problem: "application_selection_invalid",
    },
  });
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /^Choose another collection$/ }),
  );
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .filter((call) => call.action === "chooseAnother"),
    ).toHaveLength(1),
  );
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "select"),
  ).toBe(false);
});

it("does not open a workspace from transport readiness alone, and configures only on an explicit click", async () => {
  const f = await fixture();
  const value = {
    ...f.ready(),
    status: "setup_required" as const,
    readiness: {
      ...f.ready().readiness,
      assessment: { status: "setup_required" as const, problem: null },
    },
  };
  f.sdk.controls.publishSnapshot(value);
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Set up this collection" }),
  ).toBeEnabled();
  expect(screen.queryByText("Original workspace")).not.toBeInTheDocument();
  expect(
    f.sdk.controls
      .observedActions()
      .some((call) => call.action === "configure"),
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Set up this collection" }),
  );
  await waitFor(() =>
    expect(
      f.sdk.controls
        .observedActions()
        .filter((call) => call.action === "configure"),
    ).toHaveLength(1),
  );
});
