import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  MdbaseApplicationSession,
  MdbaseBrowserSelection,
  type MdbaseAppManifest,
} from "@mdbase-dev/connect";

const harness = vi.hoisted(() => ({
  session: null as MdbaseApplicationSession | null,
}));

vi.mock("../cloud/connect", () => ({
  get cloudSession() {
    return harness.session!;
  },
  startCloudSession: async (
    options: Parameters<MdbaseApplicationSession["start"]>[0],
  ) => {
    const outcome = await harness.session!.start(options);
    if (!outcome.ok) throw new Error(outcome.problem.message);
  },
  isCloudCallback: (value: string) => {
    const url = new URL(value);
    return (
      url.searchParams.has("state") &&
      (url.searchParams.has("code") || url.searchParams.has("error"))
    );
  },
}));

vi.mock("./cloud-collection", () => ({
  default: ({
    authorizationError,
    callbackRetryAvailable,
    retryStartup,
  }: {
    authorizationError: string | null;
    callbackRetryAvailable: boolean;
    retryStartup: () => void;
  }) => (
    <>
      {authorizationError && <p role="alert">{authorizationError}</p>}
      {callbackRetryAvailable && (
        <button onClick={retryStartup}>Retry authorization</button>
      )}
    </>
  ),
}));

import { CollectionGate } from "./collection-gate";

const collectionId = "00000000-0000-0000-0000-000000000042";
const callback = `${location.origin}/auth/mdbase/callback?code=once&state=session`;
const declaration: MdbaseAppManifest = {
  manifest_version: 1,
  id: "dev.tasknotes.callback-test",
  name: "Callback test",
  homepage: `${location.origin}/`,
  redirect_uris: [`${location.origin}/auth/mdbase/callback`],
  requirements: {
    access: "full_collection",
    contracts: [],
    capabilities: { contract_version: 2, required: [] },
  },
};

// Exercise the real application session, base session and browser selection.
// Only the external Connect boundary is faked: its code is strictly single-use.
function setup() {
  let consumed = false;
  const info = {
    collectionId,
    displayName: "Tasks",
    operations: [],
    scope: { contracts: [], access: "full_collection" },
    authority: { kind: "hosted", durability: "provider" },
    route: "remote",
    directAccess: "disabled",
  };
  const connection = {
    collectionId,
    operations: [],
    info: () => info,
    authorizationCapabilities: () => ({
      authorized: true,
      sufficient: true,
      collectionId,
      grantedOperations: [],
      missingOperations: [],
    }),
    onConnectionChange: () => () => undefined,
  };
  const exchange = vi.fn(async () => {
    if (consumed)
      return {
        ok: false,
        problem: {
          code: "invalid_callback",
          recovery: "reauthorize",
          message:
            "Authorization callback is missing or does not match this browser session.",
        },
      };
    consumed = true;
    return { ok: true, value: { connection } };
  });
  const manifest = vi.fn(async () => ({ ok: true, value: declaration }));
  const facade = {
    manifest,
    register: async () => ({
      ok: true,
      value: {
        id: "00000000-0000-0000-0000-000000000001",
        family_identity: `bundle:${declaration.id}`,
        manifest_digest: "ab".repeat(32),
        name: declaration.name,
        requirements: declaration.requirements,
      },
    }),
    connections: () => (consumed ? [info] : []),
    connection: () => (consumed ? connection : null),
    connectionApplicationId: () => "00000000-0000-0000-0000-000000000001",
    unavailableReason: () => null,
    onConnectionsChange: () => () => undefined,
    completeAuthorization: exchange,
  };
  const session = new MdbaseApplicationSession(facade as never, {
    selection: new MdbaseBrowserSelection({ fallbackPath: "/" }),
    autoSelect: "never",
  });
  harness.session = session;
  return { exchange, manifest, session };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", callback);
});

afterEach(() => {
  harness.session?.destroy();
  history.replaceState(null, "", "/");
});

it("exchanges an initial web callback only once through SDK startup", async () => {
  const { exchange, session } = setup();
  render(<CollectionGate />);

  await waitFor(() => expect(session.getSnapshot().status).toBe("ready"));
  await waitFor(() => expect(location.search).not.toContain("code="));
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry authorization" }),
  ).not.toBeInTheDocument();
});

it("retries a transient code-exchange failure without losing the callback", async () => {
  const { exchange, session } = setup();
  exchange.mockResolvedValueOnce({
    ok: false,
    problem: {
      code: "temporarily_unavailable",
      recovery: "retry",
      message: "Authorization unavailable. Try again.",
    },
  } as never);
  render(<CollectionGate />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Authorization unavailable",
  );
  expect(exchange).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry authorization" }));

  await waitFor(() => expect(session.getSnapshot().status).toBe("ready"));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(exchange).toHaveBeenCalledTimes(2);
});

it("retries startup without replaying the callback after startup consumes it", async () => {
  const { exchange, manifest, session } = setup();
  manifest.mockResolvedValueOnce({
    ok: false,
    problem: {
      code: "temporarily_unavailable",
      recovery: "retry",
      message: "Startup unavailable. Try again.",
    },
  } as never);
  render(<CollectionGate />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Startup unavailable",
  );
  expect(exchange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry authorization" }));

  await waitFor(() => expect(session.getSnapshot().status).toBe("ready"));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(exchange).toHaveBeenCalledTimes(1);
});
