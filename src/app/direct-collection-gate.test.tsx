// @vitest-environment-options {"url":"https://ui.example/"}
import { Capacitor } from "@capacitor/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DemoTaskRepository } from "../demo/demo-task-repository";
import { directBrowserGrant } from "../storage/direct-browser-grant";
import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { takePairInvitation } from "./direct-invitation";
import { DirectCollectionGate } from "./direct-collection-gate";
import * as site from "./direct-site";
import type { OpenedCollection } from "./opened-collection";

const opened = vi.hoisted(() => vi.fn());
vi.mock("./opened-collection", () => ({
  OpenedCollection(props: Parameters<typeof OpenedCollection>[0]) {
    opened(props);
    return (
      <button onClick={props.actions.changeCollection}>Close workspace</button>
    );
  },
}));

const token = "a".repeat(64);
const server = "https://replica.example:8443";
const code = "00125847";
const credentials = { server, token };
const pair = vi.fn<Parameters<typeof DirectCollectionGate>[0]["pair"]>();
const open = vi.fn<Parameters<typeof DirectCollectionGate>[0]["open"]>();
const mount = (invitation?: string) =>
  render(
    <DirectCollectionGate invitation={invitation} pair={pair} open={open} />,
    {
      reactStrictMode: true,
    },
  );

beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>(
    "node:crypto",
  );
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("WebTransport", class {});
  Object.defineProperty(
    globalThis.WebTransport.prototype,
    "createBidirectionalStream",
    { value: vi.fn() },
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await directBrowserGrant.forget();
  vi.spyOn(site, "directSiteAvailable").mockResolvedValue(true);
  open.mockReset().mockResolvedValue(new DemoTaskRepository(1));
  pair.mockReset().mockResolvedValue(token);
});
afterEach(() => vi.unstubAllGlobals());

async function submit(
  remember: boolean,
  address = server,
  validAddress = true,
) {
  await screen.findByLabelText(/pairing code/i);
  const field = screen.queryByLabelText(/HTTPS server address/i);
  if (field) fireEvent.change(field, { target: { value: address } });
  const input = screen.getByLabelText(/pairing code/i);
  fireEvent.change(input, { target: { value: code } });
  const checkbox = screen.getByLabelText("Remember this browser");
  expect(checkbox).not.toBeChecked();
  if (remember) fireEvent.click(checkbox);
  fireEvent.click(
    screen.getByRole("button", { name: "Pair and open collection" }),
  );
  expect(input).not.toHaveAttribute("name");
  expect(input).toHaveValue(validAddress ? "" : code);
}

it("keeps an unchecked pairing only in this tab", async () => {
  const { unmount } = mount();
  await submit(false, `${server}/`);
  await screen.findByRole("button", { name: "Close workspace" });
  expect(pair).toHaveBeenCalledExactlyOnceWith({
    server,
    code,
    signal: expect.any(AbortSignal),
  });
  expect(open).toHaveBeenCalledExactlyOnceWith(
    server,
    token,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(opened.mock.lastCall?.[0].actions.collectionUi).toBeNull();
  expect(await directBrowserGrant.read()).toBeUndefined();
  expect(location.href).not.toContain(code);
  expect(location.href).not.toContain(token);
  unmount();
  expect(open.mock.calls[0][2].aborted).toBe(true);
  mount();
  expect(await screen.findByLabelText(/pairing code/i)).toHaveValue("");
  expect(open).toHaveBeenCalledTimes(1);
});

it("reopens the remembered backend and forgets only on request", async () => {
  const first = mount();
  await submit(true);
  await screen.findByRole("button", { name: "Close workspace" });
  expect(await directBrowserGrant.read()).toMatchObject(credentials);
  expect(JSON.stringify(localStorage)).not.toContain(token);
  first.unmount();
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Close workspace" }),
  );
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Forget this browser" }));
  expect(await screen.findByLabelText(/server address/i)).toHaveValue("");
  expect(await directBrowserGrant.read()).toBeUndefined();
  expect(pair).toHaveBeenCalledTimes(1);
});

it("retains an offline grant, retries it, then discards a live revoked grant", async () => {
  await directBrowserGrant.save(credentials);
  open.mockRejectedValueOnce(new Error(token));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  await screen.findByRole("button", { name: "Close workspace" });
  expect(await directBrowserGrant.read()).toMatchObject(credentials);
  await act(async () =>
    open.mock.calls[1][3]({ code: "unauthenticated", message: token }),
  );
  await screen.findByText(/pairing is no longer accepted/i);
  expect(screen.getByText("replica.example:8443")).toBeVisible();
  expect(await directBrowserGrant.read()).toBeUndefined();
  expect(document.body.textContent).not.toContain(token);
  expect(pair).not.toHaveBeenCalled();
});

it("does not pair, open or read pairing storage on an incompatible site or native shell", async () => {
  const read = vi.spyOn(directBrowserGrant, "read");
  vi.mocked(site.directSiteAvailable).mockResolvedValue(false);
  const first = mount();
  await screen.findByRole("alert");
  first.unmount();
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(site.directSiteAvailable).mockResolvedValue(true);
  mount();
  await screen.findByRole("alert");
  expect(read).not.toHaveBeenCalled();
  expect(pair).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("rejects a managed backend before handing off the one-time code", async () => {
  mount();
  await submit(true, "https://connect.mdbase.dev", false);
  await screen.findByRole("alert");
  expect(pair).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

const descriptor = "https://10.1.2.3:5180#sha256=" + "a".repeat(64);
function visitInvitation() {
  history.replaceState(
    null,
    "",
    "/#mdbase-pair=" + encodeURIComponent(descriptor),
  );
  const invite = takePairInvitation();
  expect(location.href).toBe("https://ui.example/");
  return mount(invite);
}

it("pairs only with explicit consent and the complete displayed invitation binding", async () => {
  const opaque = "opaque SDK enrollment";
  pair.mockResolvedValueOnce(opaque);
  const save = vi
    .spyOn(directBrowserGrant, "save")
    .mockResolvedValueOnce("receipt");
  visitInvitation();
  await screen.findByLabelText(/pairing code/i);
  expect(screen.queryByLabelText(/HTTPS server address/i)).toBeNull();
  expect(screen.getByText("10.1.2.3:5180")).toBeVisible();
  expect(screen.getByLabelText(/pairing code/i)).toHaveValue("");
  expect(pair).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  await submit(true, descriptor);
  await screen.findByRole("button", { name: "Close workspace" });
  expect(pair).toHaveBeenCalledExactlyOnceWith({
    server: descriptor,
    code,
    signal: expect.any(AbortSignal),
  });
  expect(save).toHaveBeenCalledExactlyOnceWith({
    server: descriptor,
    token: opaque,
  });
});

it("pauses saved access and reconnects only to the explicitly selected saved host", async () => {
  await directBrowserGrant.save(credentials);
  visitInvitation();
  const retry = await screen.findByRole("button", { name: "Reconnect" });
  expect(screen.getByText("10.1.2.3:5180")).toBeVisible();
  expect(screen.getByText("replica.example:8443")).toBeVisible();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Close workspace" });
  expect(open).toHaveBeenCalledExactlyOnceWith(
    server,
    token,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(pair).not.toHaveBeenCalled();
});

it("requires explicit forget before switching, and a fresh code after editing the target", async () => {
  await directBrowserGrant.save(credentials);
  visitInvitation();
  fireEvent.click(
    await screen.findByRole("button", { name: "Forget this browser" }),
  );
  await screen.findByLabelText(/pairing code/i);
  expect(await directBrowserGrant.read()).toBeUndefined();
  const otp = screen.getByLabelText(/pairing code/i);
  fireEvent.change(otp, { target: { value: code } });
  fireEvent.click(
    screen.getByRole("button", { name: "Use another server address" }),
  );
  fireEvent.change(screen.getByLabelText(/HTTPS server address/i), {
    target: { value: server },
  });
  expect(otp).toHaveValue("");
  expect(open).not.toHaveBeenCalled();
  expect(pair).not.toHaveBeenCalled();
});

it("reopens only an identical saved descriptor including the pin", async () => {
  vi.spyOn(directBrowserGrant, "read").mockResolvedValue({
    server: descriptor,
    token: "opaque bound grant",
    receipt: "saved",
  });
  const first = visitInvitation();
  await screen.findByRole("button", { name: "Close workspace" });
  expect(open.mock.calls[0].slice(0, 2)).toEqual([
    descriptor,
    "opaque bound grant",
  ]);
  first.unmount();
  mount(descriptor.replace(/a{64}$/, "b".repeat(64)));
  await screen.findByRole("button", { name: "Reconnect" });
  expect(open).toHaveBeenCalledTimes(1);
  expect(pair).not.toHaveBeenCalled();
});

it.each([
  "https://wrong.example/",
  "https://ui.example:444/",
  "https://ui.example/path",
  "https://ui.example/?site=other",
])(
  "rejects a pasted invitation on %s before sending a code",
  async (prefix) => {
    mount();
    await submit(
      false,
      prefix + "#mdbase-pair=" + encodeURIComponent(descriptor),
      false,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invitation for this app site",
    );
    expect(pair).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/HTTPS server address/i)).toHaveFocus();
  },
);

it("accepts a full exact-site invitation without exposing the pin in the form", async () => {
  mount();
  await submit(
    false,
    location.origin + "/#mdbase-pair=" + encodeURIComponent(descriptor),
  );
  await screen.findByRole("button", { name: "Close workspace" });
  expect(pair.mock.calls[0][0].server).toBe(descriptor);
});

it.each([
  ["unauthenticated", "incorrect or expired"],
  ["unavailable", "Pairing could not be confirmed"],
])(
  "explains %s, clears the code, preserves Remember, and focuses the retry field",
  async (code, copy) => {
    pair.mockRejectedValueOnce({ code, message: token });
    mount();
    await submit(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    // Focus moves to the retry field in an effect after the alert renders.
    await waitFor(() =>
      expect(screen.getByLabelText(/pairing code/i)).toHaveFocus(),
    );
    expect(screen.getByLabelText(/pairing code/i)).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    expect(screen.getByLabelText("Remember this browser")).toBeChecked();
    expect(document.body.textContent).not.toContain(token);
  },
);

it("explains missing WebTransport before accepting a pinned invitation and offers the trusted managed return", async () => {
  vi.stubGlobal("WebTransport", undefined);
  visitInvitation();
  expect(await screen.findByRole("alert")).toHaveTextContent("WebTransport");
  expect(screen.queryByLabelText(/pairing code/i)).toBeNull();
  expect(
    screen.getByRole("link", { name: "Return to TaskNotes" }),
  ).toHaveAttribute("href", "https://app.tasknotes.dev/");
  expect(pair).not.toHaveBeenCalled();
});

it("cancelling Change and Forget preserves the session and saved grant", async () => {
  await directBrowserGrant.save(credentials);
  mount();
  const close = await screen.findByRole("button", { name: "Close workspace" });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(close);
  expect(close).toBeVisible();
  expect(open.mock.calls[0][2].aborted).toBe(false);
  fireEvent.click(close);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Forget this browser" }));
  expect(await directBrowserGrant.read()).toMatchObject(credentials);
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
});

it("blocks saving and opening when a worker appears during redemption", async () => {
  const save = vi.spyOn(directBrowserGrant, "save");
  pair.mockImplementationOnce(async () => {
    vi.mocked(site.directSiteAvailable).mockResolvedValue(false);
    return token;
  });
  mount();
  await submit(true);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "without a service worker",
  );
  expect(save).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("keeps a redeemed grant in this tab if Remember fails and never forgets a competing receipt", async () => {
  vi.spyOn(directBrowserGrant, "save").mockRejectedValueOnce(
    new Error("quota"),
  );
  const forget = vi.spyOn(directBrowserGrant, "forget");
  mount();
  await submit(true);
  await screen.findByRole("button", { name: "Close workspace" });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Paired for this tab only",
  );
  await act(async () =>
    open.mock.calls[0][3]({ code: "unavailable" }, ["Planning"]),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Planning");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Close workspace" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByLabelText(/pairing code/i);
  expect(open.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    [server, token],
    [server, token],
  ]);
  expect(pair).toHaveBeenCalledTimes(1);
  expect(forget).not.toHaveBeenCalled();
});

it("keeps a tab-only draft through a reconnect without describing it as a submitted write", async () => {
  mount();
  await submit(false);
  await screen.findByRole("button", { name: "Close workspace" });
  const { actions } = opened.mock.lastCall![0];
  actions.taskEditStorage.setItem("example", "still editing");
  actions.onTaskDraft({ title: "still editing" });
  await act(async () => open.mock.calls[0][3]({ code: "unavailable" }));
  expect(screen.getByRole("alert")).not.toHaveTextContent("may have reached");
  expect(screen.getByLabelText("Unsaved task edits")).toHaveValue(
    "still editing",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  await screen.findByRole("button", { name: "Close workspace" });
  expect(
    opened.mock.lastCall![0].actions.taskEditStorage.getItem("example"),
  ).toBe("still editing");
});

it("says a deletion was cancelled on disconnect only when one was waiting", async () => {
  mount();
  await submit(false);
  await screen.findByRole("button", { name: "Close workspace" });
  await act(async () => open.mock.calls[0][3]({ code: "unavailable" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Undo window");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  await screen.findByRole("button", { name: "Close workspace" });
  await act(async () =>
    opened.mock.lastCall![0].actions.onDeletionWaiting!(true),
  );
  await act(async () => open.mock.lastCall![3]({ code: "unavailable" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The deletion waiting in the Undo window was cancelled.",
  );
});

it("blocks revocation storage access if a worker appeared in a live session", async () => {
  await directBrowserGrant.save(credentials);
  const forget = vi.spyOn(directBrowserGrant, "forget");
  const key =
    "tasknotes:unsaved-task-edit:v1:direct:direct:" + server + "/test:task";
  localStorage.setItem(key, "private draft");
  mount();
  await screen.findByRole("button", { name: "Close workspace" });
  vi.mocked(site.directSiteAvailable).mockResolvedValue(false);
  await act(async () => open.mock.calls[0][3]({ code: "unauthenticated" }));
  expect(await screen.findByText(/without a service worker/)).toBeVisible();
  expect(forget).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBe("private draft");
  localStorage.removeItem(key);
});

it("blocks explicit forgetting if a worker is registered since pairing", async () => {
  await directBrowserGrant.save(credentials);
  const forget = vi.spyOn(directBrowserGrant, "forget");
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Close workspace" }),
  );
  vi.mocked(site.directSiteAvailable).mockResolvedValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Forget this browser" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "without a service worker",
  );
  expect(forget).not.toHaveBeenCalled();
});

it("rechecks a remembered receipt before reconnecting and never sends credentials to its replacement automatically", async () => {
  const read = vi
    .spyOn(directBrowserGrant, "read")
    .mockResolvedValue({ ...credentials, receipt: "first" });
  open.mockRejectedValueOnce(new Error("offline"));
  mount();
  const retry = await screen.findByRole("button", { name: "Reconnect" });
  const replacement = {
    server: "https://different.example",
    token: "replacement",
    receipt: "second",
  };
  read.mockResolvedValue(replacement);
  fireEvent.click(retry);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "saved pairing changed",
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("different.example")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  await screen.findByRole("button", { name: "Close workspace" });
  expect(open.mock.calls[1].slice(0, 2)).toEqual([
    replacement.server,
    replacement.token,
  ]);
});

it("keeps the open tab session when the same invitation arrives without a page load", async () => {
  vi.spyOn(directBrowserGrant, "read").mockResolvedValue({
    server: descriptor,
    token,
    receipt: "receipt",
  });
  visitInvitation();
  const workspace = await screen.findByRole("button", {
    name: "Close workspace",
  });
  history.replaceState(
    null,
    "",
    "/#mdbase-pair=" + encodeURIComponent(descriptor),
  );
  fireEvent(window, new Event("hashchange"));
  expect(location.hash).toBe("");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(workspace).toBeVisible();
  expect(open).toHaveBeenCalledTimes(1);
});

it("re-reads unavailable storage before offering to forget an identified pairing", async () => {
  const receipt = await directBrowserGrant.save(credentials);
  vi.spyOn(directBrowserGrant, "read").mockRejectedValueOnce(
    new Error("blocked"),
  );
  const forget = vi.spyOn(directBrowserGrant, "forget");
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "storage settings",
  );
  expect(
    screen.queryByRole("button", { name: "Forget this browser" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Forget this browser" }),
  );
  await screen.findByLabelText(/pairing code/i);
  expect(forget).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(open).not.toHaveBeenCalled();
});

it.each(["pair", "saved"])(
  "shows the SDK pin-capability failure during %s without fallback or clearing stored access",
  async (mode) => {
    const failure = {
      code: "unavailable",
      reason: "browser_unsupported",
      message: token,
    };
    if (mode === "saved") {
      vi.spyOn(directBrowserGrant, "read").mockResolvedValue({
        server: descriptor,
        token,
        receipt: "saved",
      });
      open.mockRejectedValueOnce(failure);
    } else pair.mockRejectedValueOnce(failure);
    visitInvitation();
    if (mode === "pair") await submit(false, descriptor);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WebTransport support",
    );
    expect(screen.queryByLabelText(/pairing code/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(open).toHaveBeenCalledTimes(mode === "saved" ? 1 : 0);
    expect(pair).toHaveBeenCalledTimes(mode === "saved" ? 0 : 1);
    expect(document.body.textContent).not.toContain(token);
  },
);

it("includes local-network permission guidance for an ambiguous pinned pairing", async () => {
  pair.mockRejectedValueOnce({ code: "unavailable" });
  visitInvitation();
  await submit(false, descriptor);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "allow local-network access for this site",
  );
});

it("keeps a code on an address-only error, then clears it when the valid destination changes", async () => {
  mount();
  const otp = await screen.findByLabelText(/pairing code/i);
  fireEvent.change(otp, { target: { value: code } });
  fireEvent.click(
    screen.getByRole("button", { name: "Pair and open collection" }),
  );
  expect(otp).toHaveValue(code);
  const address = screen.getByLabelText(/HTTPS server address/i);
  fireEvent.change(address, { target: { value: server } });
  expect(otp).toHaveValue(code);
  fireEvent.change(address, { target: { value: "https://changed.example" } });
  expect(otp).toHaveValue("");
  expect(pair).not.toHaveBeenCalled();
});

it.each(["forget", "revocation"])(
  "clears only the exact direct server's persisted collection state on %s",
  async (how) => {
    const scope = "direct:direct:" + server + "/test";
    const kept = [
      "tasknotes:unsaved-task-edit:v1:direct:direct:" +
        server +
        ".other/test:task",
      "tasknotes:unsaved-task-edit:v1:connect:managed:task",
      "tasknotes:sidebar-collapsed",
      "tasknotes:locale",
    ];
    const cleared = [
      "tasknotes:unsaved-task-edit:v1:" + scope + ":task",
      "tasknotes:recent-searches:v1:" + scope,
      "tasknotes:recent-tasks:v1:" + scope,
      "tasknotes:scratchpad-collapse:direct:" + server + "/test",
      "tasknotes:auto-archive:v1:" + scope,
      "tasknotes:section:" + JSON.stringify([scope, "today"]) + ":overdue",
    ];
    for (const key of [...kept, ...cleared])
      localStorage.setItem(key, "private");
    await directBrowserGrant.save(credentials);
    mount();
    const close = await screen.findByRole("button", {
      name: "Close workspace",
    });
    if (how === "forget") {
      fireEvent.click(close);
      fireEvent.click(
        screen.getByRole("button", { name: "Forget this browser" }),
      );
    } else {
      await act(async () => open.mock.calls[0][3]({ code: "unauthenticated" }));
    }
    await screen.findByLabelText(/pairing code/i);
    expect(cleared.map((key) => localStorage.getItem(key))).toEqual(
      cleared.map(() => null),
    );
    expect(kept.map((key) => localStorage.getItem(key))).toEqual(
      kept.map(() => "private"),
    );
    kept.forEach((key) => localStorage.removeItem(key));
  },
);

it("removes a tab-only pairing's collection state when its tab goes away", async () => {
  const key = "tasknotes:recent-searches:v1:direct:direct:" + server + "/test";
  mount();
  await submit(false);
  await screen.findByRole("button", { name: "Close workspace" });
  // The pagehide listener is attached once the tab grant commits, which can
  // land just after the workspace renders: retry until it is listening.
  await waitFor(() => {
    localStorage.setItem(key, '["private search"]');
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(key)).toBeNull();
  });
});

it("keeps a remembered pairing's collection state when its tab goes away", async () => {
  const key = "tasknotes:recent-searches:v1:direct:direct:" + server + "/test";
  await directBrowserGrant.save(credentials);
  mount();
  await screen.findByRole("button", { name: "Close workspace" });
  localStorage.setItem(key, '["private search"]');
  window.dispatchEvent(new Event("pagehide"));
  expect(localStorage.getItem(key)).toBe('["private search"]');
  localStorage.removeItem(key);
});

it("says the code is still good when the server was never reached", async () => {
  pair.mockRejectedValue({ code: "unavailable", reason: "code_not_sent" });
  mount();
  await submit(false);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "your code was not used",
  );
  pair.mockRejectedValue({ code: "unavailable" });
  await submit(false);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "check whether the browser was paired",
  );
});
