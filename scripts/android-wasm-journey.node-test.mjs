import test from "node:test";
import assert from "node:assert/strict";
import {
  liveApplicationPage,
  launchNativeBrowser,
  openNativeWorkspace,
  ownedFixtureInstallations,
  approveNativePortal,
  pairingObservation,
  actionabilityObservation,
} from "./android-wasm-journey.mjs";

const page = (url, closed = false) => ({
  url: () => url,
  isClosed: () => closed,
});
const context = (...pages) => ({ pages: () => pages });

function workspace(initialized, setupError = null) {
  let clicks = 0;
  return {
    clicks: () => clicks,
    getByRole: (_role, { name }) =>
      name === "Set up"
        ? {
            isVisible: async () => !initialized,
            click: async () => {
              clicks++;
              if (setupError) throw setupError;
              initialized = true;
            },
          }
        : {
            isVisible: async () => initialized,
            waitFor: async () => assert.equal(initialized, true),
          },
  };
}

for (const closed of [false, true]) {
  test(`native approval submits only once across a tab return (closed=${closed})`, async () => {
    let attempts = 0;
    const failure = new Error("unknown-approval-write");
    const labels = [];
    const button = {
      or: () => button,
      click: async (options) => {
        attempts++;
        assert.equal(options.noWaitAfter, true);
        throw failure;
      },
    };
    const portal = {
      isClosed: () => closed,
      getByRole: (role, options) => {
        assert.equal(role, "button");
        assert.equal(options.exact, true);
        labels.push(options.name);
        return button;
      },
    };
    const name = "[test] agent-owned-approval";
    if (closed) await approveNativePortal(portal, name);
    else
      await assert.rejects(
        approveNativePortal(portal, name),
        (e) => e === failure,
      );
    assert.equal(attempts, 1);
    assert.deepEqual(labels, ["Open TaskNotes", `Open TaskNotes with ${name}`]);
  });
}

test("actionability diagnostics never retain error text or private values", () => {
  for (const [message, expected] of [
    ["private-token intercepts pointer events", "approval-pointer-intercepted"],
    ["private-token outside of the viewport", "approval-outside-viewport"],
    ["private-token element is not stable", "approval-element-unstable"],
    ["private-token element is not visible", "approval-element-hidden"],
    ["private-token strict mode violation", "approval-locator-ambiguous"],
    ["private-token", "approval-error-unclassified"],
  ]) {
    assert.equal(actionabilityObservation(new Error(message)), expected);
  }
  assert.equal(
    actionabilityObservation({
      name: "TimeoutError",
      message: "private-token",
    }),
    "approval-timeout-unclassified",
  );
  assert.equal(actionabilityObservation(null), "approval-error-unclassified");
});

test("a missing Chrome debugging socket has a bounded preflight deadline", async () => {
  await assert.rejects(
    launchNativeBrowser({ launchBrowser: () => new Promise(() => {}) }, 5),
    /native-browser-start-deadline/,
  );
});

test("a browser startup error is preserved, never retried", async () => {
  let attempts = 0;
  const failure = new Error("browser-unavailable");
  await assert.rejects(
    launchNativeBrowser(
      {
        launchBrowser: async () => {
          attempts++;
          throw failure;
        },
      },
      100,
    ),
    (error) => error === failure,
  );
  assert.equal(attempts, 1);
});

test("initializes a retained empty fixture, not just a newly created one", async () => {
  const page = workspace(false);
  const phases = [];
  await openNativeWorkspace(page, (phase) => phases.push(phase));
  assert.equal(page.clicks(), 1);
  assert.deepEqual(phases, [
    "native-workspace-state",
    "model-setup-submit",
    "model-setup-confirm",
  ]);
});

test("does not submit setup when the fixture is already initialized", async () => {
  const page = workspace(true);
  await openNativeWorkspace(page);
  assert.equal(page.clicks(), 0);
});

test("never retries an uncertain model setup write", async () => {
  const unknown = new Error("outcome-unknown");
  const page = workspace(false, unknown);
  await assert.rejects(openNativeWorkspace(page), (error) => error === unknown);
  assert.equal(page.clicks(), 1);
});

test("approval observations distinguish dispatch, attestation and exact target approval", () => {
  const name = "[test] agent-owned";
  const pairing = {
    installation_device: true,
    collections: [{ collection_id: "private-id", display_name: name }],
    selected_collection_id: "private-id",
  };
  const state = (extra) =>
    pairingObservation({ pairing: { ...pairing, ...extra } }, name);
  assert.equal(state({}), "pairing-account-unconfirmed");
  assert.equal(
    state({ account_selection_confirmed: true }),
    "pairing-account-confirmed",
  );
  assert.equal(state({ attested: true }), "pairing-attested");
  assert.equal(
    state({ approved_at: "private-time" }),
    "pairing-approved-owned",
  );
  assert.equal(
    state({ approved_at: true, selected_collection_id: "different" }),
    "pairing-approved-target-unverified",
  );
  assert.equal(
    pairingObservation(null, name),
    "pairing-observation-unavailable",
  );
});

const fixture = "[test] agent-native-fixture";
const installation = (connector_id, collection_name = fixture) => ({
  connector_id,
  collection_name,
  application_name: "TaskNotes",
  application_origin: "https://app.tasknotes.dev",
});

test("cleans only new installations scoped exclusively to the owned fixture", () => {
  const existing = installation("existing");
  const unrelated = installation("other-lane", "[test] other-lane");
  assert.deepEqual(
    ownedFixtureInstallations(
      { installations: [existing] },
      { installations: [existing, unrelated, installation("owned")] },
      fixture,
    ),
    ["owned"],
  );
});

test("refuses revocation when a new installation also covers another fixture", () => {
  assert.throws(
    () =>
      ownedFixtureInstallations(
        { installations: [] },
        {
          installations: [
            installation("mixed"),
            installation("mixed", "other"),
          ],
        },
        fixture,
      ),
    /ownership-ambiguous/,
  );
});

test("refuses revocation when the app identity does not match", () => {
  assert.throws(
    () =>
      ownedFixtureInstallations(
        { installations: [] },
        {
          installations: [
            { ...installation("foreign"), application_name: "Other" },
          ],
        },
        fixture,
      ),
    /ownership-ambiguous/,
  );
});

test("reacquires the live app target instead of a cached closed WebView page", () => {
  const retired = page("https://app.tasknotes.dev/", true);
  const replacement = page("https://app.tasknotes.dev/");
  assert.equal(
    liveApplicationPage(context(retired, replacement), retired),
    replacement,
  );
});

test("does not reuse the original document while recreation is pending", () => {
  const retired = page("https://app.tasknotes.dev/");
  assert.equal(liveApplicationPage(context(retired), retired), undefined);
});

test("waits through blank targets and excludes portal/foreign origins", () => {
  assert.equal(
    liveApplicationPage(
      context(
        page(""),
        page("about:blank"),
        page("https://connect.mdbase.dev/"),
        page("https://app.tasknotes.dev.evil.example/"),
      ),
    ),
    undefined,
  );
});
