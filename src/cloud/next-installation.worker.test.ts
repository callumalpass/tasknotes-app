import { webcrypto, createHash } from "node:crypto";
import type { NextInstallationRequest } from "./next-installation-protocol";
const methods = vi.hoisted(() => ({
  open: vi.fn(),
  view: vi.fn(),
  start: vi.fn(),
  renewExpiredPairing: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./next-installation", () => ({
  NextTaskNotesInstallation: { open: methods.open },
}));
vi.mock("./app-environment", () => ({
  requireTaskNotesAppEnvironment: vi.fn(),
}));
const artifact = Uint8Array.of(1);
const view = { state: "pending", requestId: "test-child" };
async function opened() {
  vi.resetModules();
  vi.resetAllMocks();
  const post = vi.fn(),
    stop = vi.fn();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", { locks: undefined });
  vi.stubGlobal("postMessage", post);
  vi.stubGlobal("close", stop);
  methods.open.mockResolvedValue(methods);
  methods.view.mockReturnValue(view);
  methods.start.mockResolvedValue(view);
  methods.renewExpiredPairing.mockResolvedValue(view);
  await import("./next-installation.worker");
  async function send(id: number, command: NextInstallationRequest["command"]) {
    globalThis.onmessage!(
      new MessageEvent("message", { data: { version: 1, id, command } }),
    );
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ id })),
    );
    return post.mock.calls.at(-1)![0];
  }
  await send(1, {
    kind: "open",
    mode: "existing",
    build: {
      environment: "lab",
      appOrigin: "http://127.0.0.1:48218",
      release: {} as never,
      runtime: artifact,
      runtimeSha256: createHash("sha256").update(artifact).digest("hex"),
    },
  });
  return { send, post, stop };
}
afterEach(() => {
  globalThis.onmessage = null;
  vi.unstubAllGlobals();
});
describe("fixed renewal Worker runtime dispatch (source stand-ins)", () => {
  it("dispatches renewal and SAME-successor resume on one original controller", async () => {
    const worker = await opened();
    expect(await worker.send(2, { kind: "renew-expired" })).toMatchObject({
      ok: true,
      result: view,
    });
    expect(methods.renewExpiredPairing).toHaveBeenCalledOnce();
    expect(await worker.send(3, { kind: "start" })).toMatchObject({
      ok: true,
      result: view,
    });
    expect(methods.start).toHaveBeenCalledOnce();
    expect(methods.open).toHaveBeenCalledOnce();
    expect(methods.close).not.toHaveBeenCalled();
    expect(worker.stop).not.toHaveBeenCalled();
    await worker.send(4, { kind: "close" });
  });
  it("unknown renewal error crosses as code only and never creates another controller", async () => {
    const worker = await opened();
    methods.renewExpiredPairing.mockRejectedValueOnce({
      reason: "outcome_unknown",
      body: "must not leave Worker",
    });
    expect(await worker.send(2, { kind: "renew-expired" })).toEqual({
      version: 1,
      id: 2,
      ok: false,
      reason: "outcome_unknown",
    });
    expect(methods.renewExpiredPairing).toHaveBeenCalledOnce();
    await worker.send(3, { kind: "start" });
    expect(methods.open).toHaveBeenCalledOnce();
    expect(methods.start).toHaveBeenCalledOnce();
    expect(methods.close).not.toHaveBeenCalled();
    await worker.send(4, { kind: "close" });
  });
});
