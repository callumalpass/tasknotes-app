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
  describeError,
  summarizeStatus,
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

it.each(["refused", "expired"])(
  "keeps a %s sign-in renewable through the original SDK approve gesture",
  async (problem) => {
    const f = await fixture();
    f.sdk.controls.publishSnapshot({
      ...initial(),
      status: "blocked",
      problem,
    });
    render(
      <ApplicationCollectionGate
        entry={f.sdk.entry}
        Picker={Picker}
        Workspace={Workspace}
      />,
    );
    const description = describeError(f.sdk.entry.application().getSnapshot());
    expect(description?.action).toBe("sign_in");
    expect(screen.getByText(description!.title)).toBeVisible();
    expect(screen.getByText(description!.message)).toBeVisible();
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn).toBeEnabled();
    fireEvent.click(signIn);
    await waitFor(() =>
      expect(
        f.sdk.controls
          .observedActions()
          .filter((call) => call.action === "approve"),
      ).toHaveLength(1),
    );
    expect(
      f.sdk.controls
        .observedActions()
        .some((call) =>
          ["select", "clearSelection", "chooseAnother"].includes(call.action),
        ),
    ).toBe(false);
  },
);

it("keeps Sign in enabled while authorizing and forwards every retry gesture to the same SDK owner", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot({ ...initial(), status: "authorizing" });
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.sdk.controls.setHandler("approve", () => waiting);
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  const signIn = screen.getByRole("button", { name: "Sign in" });
  expect(signIn).toBeEnabled();
  fireEvent.click(signIn);
  expect(signIn).toBeEnabled();
  fireEvent.click(signIn);
  expect(
    f.sdk.controls
      .observedActions()
      .filter((call) => call.action === "approve"),
  ).toHaveLength(2);
  await act(async () => finish());
});

it("keeps the original workspace and unsaved input through a live migration and SDK resumption", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot(f.ready());
  function DraftWorkspace(props: Parameters<typeof OpenedCollection>[0]) {
    return (
      <>
        <Workspace {...props} />
        <input aria-label="Unsaved task" defaultValue="Initial draft" />
      </>
    );
  }
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={DraftWorkspace}
    />,
  );
  const input = await screen.findByRole("textbox", { name: "Unsaved task" });
  fireEvent.change(input, { target: { value: "Keep my exact draft" } });
  const originalClient = f.sdk.entry.connection(f.connection.id)!.records;
  await act(async () => {
    f.sdk.controls.publishSnapshot({
      ...f.ready(),
      problem: "collection_migrating",
    });
  });
  expect(screen.getByRole("textbox", { name: "Unsaved task" })).toBe(input);
  expect(input).toHaveValue("Keep my exact draft");
  const migrationStatus = summarizeStatus(
    originalClient.status,
    "collection_migrating",
  ).text;
  expect(screen.getByRole("status")).toHaveTextContent(migrationStatus);
  expect(
    screen.getByText(describeError("collection_migrating")!.message),
  ).toBeVisible();
  expect(f.sdk.entry.connection(f.connection.id)!.records).toBe(originalClient);
  await act(async () => f.sdk.controls.publishSnapshot(f.ready()));
  expect(screen.getByRole("textbox", { name: "Unsaved task" })).toBe(input);
  expect(input).toHaveValue("Keep my exact draft");
  expect(screen.queryByText(migrationStatus)).toBeNull();
  expect(
    f.sdk.controls.observedActions().filter((call) => call.action === "start"),
  ).toHaveLength(1);
  expect(
    f.sdk.controls
      .observedActions()
      .filter((call) =>
        ["select", "approve", "configure", "close"].includes(call.action),
      ),
  ).toHaveLength(0);
});

it("keeps the open workspace, repository and in-flight work while readiness re-checks a change", async () => {
  const f = await fixture();
  f.sdk.controls.publishSnapshot(f.ready());
  const mounts: TaskRepository[] = [];
  function CountingWorkspace(props: Parameters<typeof OpenedCollection>[0]) {
    useEffect(() => {
      mounts.push(props.repository);
    }, [props.repository]);
    return <Workspace {...props} />;
  }
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={CountingWorkspace}
    />,
  );
  expect(await screen.findByText("Original workspace")).toBeVisible();
  const recheck = (): MdbaseApplicationSnapshot => ({
    ...f.ready(),
    status: "opening",
    readiness: { ...f.ready().readiness, checking: true, assessment: null },
  });
  // Every collection change (own writes included) re-checks readiness. A
  // teardown per re-check suspended the repository, cancelling discovery and
  // write confirmation, then remounted and rediscovered: the discovery storm.
  for (let index = 0; index < 5; index++) {
    await act(async () => f.sdk.controls.publishSnapshot(recheck()));
    expect(screen.getByText("Original workspace")).toBeVisible();
    await act(async () => f.sdk.controls.publishSnapshot(f.ready()));
  }
  expect(mounts).toHaveLength(1);
  // A settled non-ready verdict still closes it.
  await act(async () =>
    f.sdk.controls.publishSnapshot({
      ...f.ready(),
      status: "setup_required",
      readiness: {
        ...f.ready().readiness,
        assessment: { status: "setup_required", problem: null },
      },
    }),
  );
  expect(screen.queryByText("Original workspace")).not.toBeInTheDocument();
});

it("uses shared registration-refusal copy and logs only its SDK developer description", async () => {
  const f = await fixture();
  const snapshot: MdbaseApplicationSnapshot = {
    ...initial(),
    status: "blocked",
    problem: "application_registration_refused",
    problemDetail: {
      name: "MdbaseError",
      code: "forbidden",
      registration: {
        code: "invalid_application_manifest",
        paths: ["/homepage", "/icon"],
      },
    },
  };
  const description = describeError(snapshot)!;
  const diagnostic = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  try {
    f.sdk.controls.publishSnapshot(snapshot);
    render(
      <ApplicationCollectionGate
        entry={f.sdk.entry}
        Picker={Picker}
        Workspace={Workspace}
      />,
    );
    expect(await screen.findByText(description.title)).toBeVisible();
    expect(screen.getByText(description.message)).toBeVisible();
    expect(screen.queryByText("Sign-in was interrupted")).toBeNull();
    expect(
      screen.queryByText(/invalid_application_manifest|\/homepage|\/icon/),
    ).toBeNull();
    await waitFor(() =>
      expect(diagnostic).toHaveBeenCalledWith(
        "[TaskNotes]",
        description.developerMessage,
      ),
    );
    expect(screen.queryByRole("button", { name: /^Retry$/ })).toBeNull();
  } finally {
    diagnostic.mockRestore();
  }
});

it("forwards optional SDK collection metadata verbatim to the picker without claiming availability", async () => {
  const f = await fixture();
  const collection = {
    ...f.ready().collections[0]!,
    availability: {
      state: "unavailable" as const,
      reason: "device_offline" as const,
    },
  };
  // Synthetic public presentation metadata only. SDK6a does not yet enumerate
  // this field in production; SDK9c90075 owns that successor fix.
  f.sdk.controls.publishSnapshot({ ...f.ready(), collections: [collection] });
  let choices: ApplicationPickerProps["connections"] | undefined;
  function MetadataPicker(props: ApplicationPickerProps) {
    useEffect(() => {
      choices = props.connections;
    }, [props.connections]);
    return <Picker {...props} />;
  }
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={MetadataPicker}
      Workspace={Workspace}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Change collection" }),
  );
  expect(choices).toBe(f.sdk.entry.application().getSnapshot().collections);
  expect(choices?.[0]?.availability).toEqual(collection.availability);
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "select"),
  ).toBe(false);
});

it("keeps a named unavailable SDK choice visible on the welcome screen without dispatching Open", async () => {
  const f = await fixture();
  const collection = {
    ...f.ready().collections[0]!,
    availability: {
      state: "unavailable" as const,
      reason: "desktop_update_required" as const,
    },
  };
  f.sdk.controls.publishSnapshot({
    ...initial(),
    status: "unselected",
    collections: [collection],
  });
  render(
    <ApplicationCollectionGate
      entry={f.sdk.entry}
      Picker={Picker}
      Workspace={Workspace}
    />,
  );
  const description = describeError(collection)!;
  const row = await screen.findByRole("button", {
    name: `${collection.displayName}, ${description.title}`,
  });
  expect(row).toBeDisabled();
  expect(row).toHaveTextContent(collection.displayName);
  expect(row).toHaveTextContent(description.message);
  expect(row).toHaveTextContent(description.actionLabel!);
  fireEvent.click(row);
  expect(
    f.sdk.controls.observedActions().some((call) => call.action === "select"),
  ).toBe(false);
});

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
