import type { NextInstallationRequest } from "./next-installation-protocol";
import { resourceSetupPlan } from "../test/resource-setup-plan";
import { TASKNOTES_APPLICATION_REGISTRATION } from "./next-application-registration";
const methods = vi.hoisted(() => ({
  open: vi.fn(),
  view: vi.fn(),
  start: vi.fn(),
  renewExpiredPairing: vi.fn(),
  createCloudCopyCollection: vi.fn(),
  modelSetupIntent: vi.fn(),
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
  vi.stubGlobal("navigator", { locks: undefined });
  vi.stubGlobal("postMessage", post);
  vi.stubGlobal("close", stop);
  methods.open.mockResolvedValue(methods);
  methods.view.mockReturnValue(view);
  methods.start.mockResolvedValue(view);
  methods.renewExpiredPairing.mockResolvedValue(view);
  await import("./next-installation.worker");
  async function send(id: number, command: NextInstallationRequest["command"]) {
    globalThis.onmessage!.call(
      window,
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
      ...TASKNOTES_APPLICATION_REGISTRATION,
      release: {} as never,
      runtime: artifact,
      runtimeSha256: Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", artifact)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
    },
  });
  return { send, post, stop };
}
afterEach(() => {
  globalThis.onmessage = null;
  vi.unstubAllGlobals();
});
describe("fixed renewal Worker runtime dispatch (source stand-ins)", () => {
  it("forwards explicit build registration and original restore mode to its controller", async () => {
    const worker = await opened();
    expect(methods.open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...TASKNOTES_APPLICATION_REGISTRATION,
        appOrigin: "http://127.0.0.1:48218",
        environment: "lab",
        mode: "existing",
      }),
    );
    expect(methods.start).not.toHaveBeenCalled();
    await worker.send(2, { kind: "close" });
  });
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
  it("creation refusal crosses as code only and explicit recovery stays on the original controller", async () => {
    const worker = await opened();
    methods.createCloudCopyCollection.mockRejectedValueOnce({
      reason: "outcome_unknown",
      body: "private",
    });
    expect(
      await worker.send(2, { kind: "create-collection", reconcile: false }),
    ).toEqual({ version: 1, id: 2, ok: false, reason: "outcome_unknown" });
    expect(methods.createCloudCopyCollection).toHaveBeenCalledExactlyOnceWith(
      false,
    );
    methods.createCloudCopyCollection.mockResolvedValueOnce({
      kind: "created-collection",
      collectionId: "11111111-1111-4111-8111-111111111111",
      displayName: "New collection",
    });
    expect(
      await worker.send(3, { kind: "create-collection", reconcile: true }),
    ).toMatchObject({ ok: true, result: { kind: "created-collection" } });
    expect(methods.createCloudCopyCollection).toHaveBeenLastCalledWith(true);
    expect(methods.open).toHaveBeenCalledOnce();
    await worker.send(4, { kind: "close" });
  });
  it("routes fixed v3 commands to the original controller, retaining code-only refusals", async () => {
    const worker = await opened();
    const command = {
      kind: "model-resource-setup-intent" as const,
      action: "prepare" as const,
      plan: resourceSetupPlan(),
    };
    const intent = {
      version: 3,
      scope: {
        account: "11111111-1111-4111-8111-111111111111",
        installation: "22222222-2222-4222-8222-222222222222",
        collection: "33333333-3333-4333-8333-333333333333",
      },
      mutationId: "55555555-5555-4555-8555-555555555555",
      plan: command.plan,
      phase: "prepared",
    };
    methods.modelSetupIntent.mockResolvedValueOnce(intent);
    expect(await worker.send(2, command)).toEqual({
      version: 1,
      id: 2,
      ok: true,
      result: intent,
    });
    expect(methods.modelSetupIntent).toHaveBeenCalledExactlyOnceWith(command);
    const attempt = {
      kind: "model-resource-setup-intent" as const,
      action: "attempt" as const,
      mutationId: intent.mutationId,
    };
    methods.modelSetupIntent.mockRejectedValueOnce({
      reason: "recovery_required",
      body: "private",
    });
    expect(await worker.send(3, attempt)).toEqual({
      version: 1,
      id: 3,
      ok: false,
      reason: "recovery_required",
    });
    expect(methods.modelSetupIntent).toHaveBeenLastCalledWith(attempt);
    expect(methods.open).toHaveBeenCalledOnce();
    expect(methods.createCloudCopyCollection).not.toHaveBeenCalled();
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
