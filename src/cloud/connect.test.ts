import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  effectiveCapabilities,
  operationsForApplicationCapabilities,
  type MdbaseAppManifest,
  type MdbaseConnectionInfo,
  type MdbaseOperation,
} from "@mdbase-dev/connect";
import { connectSuccess } from "@mdbase-dev/connect-testing";
import {
  APPLICATION_AUTHORIZATION_V2_ISSUANCE_CAPABILITY,
  type ApplicationCapabilityRequirements,
} from "@mdbase-dev/connect-protocol";

import bundledManifest from "../generated/mdbase-app.json";
import { cloudConnect, cloudSession } from "./connect";

const expectedOperations: MdbaseOperation[] = [
  ...operationsForApplicationCapabilities(
    bundledManifest.requirements
      .capabilities as ApplicationCapabilityRequirements,
  ),
  // The v2 session derives setup authority from provisions, not a capability
  // alias. File grants and notification registration have separate APIs.
  "assess_collection_setup",
  "apply_collection_setup",
];
let registrationRequestBody: unknown;

describe("TaskNotes mdbase session", () => {
  beforeAll(async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (!String(input).endsWith("/v1/apps/register")) {
          throw new Error(
            `Unexpected TaskNotes session request: ${String(input)}`,
          );
        }
        registrationRequestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            application: {
              id: "00000000-0000-0000-0000-000000000001",
              family_identity: "bundle:dev.tasknotes.app",
              manifest_digest: "a".repeat(64),
              name: "TaskNotes",
              homepage: "https://app.tasknotes.dev/",
              requirements: bundledManifest.requirements,
              provisions: bundledManifest.provisions,
              distribution: "web",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });
    const started = await cloudSession.start();
    fetch.mockRestore();
    if (!started.ok) throw new Error(started.problem.message);
  });

  afterAll(() => cloudSession.destroy());

  afterEach(() => {
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("expands v2 groups without legacy aliases or offline replication", () => {
    expect(expectedOperations).not.toContain(undefined);
    expect(expectedOperations).toEqual(
      expect.arrayContaining([
        "read",
        "query",
        "create",
        "update",
        "rename",
        "delete",
        "delete_view_source",
        "apply_type_pack",
        "reconcile_timers",
        "assess_collection_setup",
        "apply_collection_setup",
      ]),
    );
    expect(expectedOperations).not.toContain("sync");
  });

  it("evaluates required capabilities through the real SDK without throwing", () => {
    const manifest = bundledManifest as MdbaseAppManifest;
    const info: MdbaseConnectionInfo = {
      collectionId: "test-collection",
      displayName: "Test",
      operations: expectedOperations,
      scope: { access: "full_collection", contracts: [] },
      authority: { kind: "hosted", durability: "provider" },
      route: "remote",
      directAccess: "disabled",
    };
    const evaluate = () =>
      effectiveCapabilities(
        manifest.requirements!.capabilities!,
        manifest,
        info,
      );
    expect(evaluate).not.toThrow();
    expect(evaluate().requiredAvailable).toBe(true);
    expect(evaluate().values["background.schedule"]?.state).toBe("available");
    info.operations = info.operations.filter(
      (operation) => operation !== "delete",
    );
    expect(evaluate().requiredAvailable).toBe(false);
    expect(evaluate().values["records.delete"]?.state).toBe(
      "requires_authorization",
    );
    info.operations = expectedOperations;
    info.scope = { access: "contract", contracts: [] };
    expect(evaluate().requiredAvailable).toBe(false);
    expect(evaluate().values["collection.read"]?.state).toBe(
      "requires_authorization",
    );
    info.operations = [];
    expect(evaluate().requiredAvailable).toBe(false);
  });

  it("sends exact v2 authorization through the real SDK and preserves denial", async () => {
    let request: URLSearchParams | undefined;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input) === "https://connect.mdbase.dev/health") {
          return Response.json({
            capabilities: [APPLICATION_AUTHORIZATION_V2_ISSUANCE_CAPABILITY],
          });
        }
        expect(String(input)).toBe(
          "https://connect.mdbase.dev/oauth/authorization_request",
        );
        request = new URLSearchParams(String(init?.body));
        return new Response(
          JSON.stringify({
            error: "access_denied",
            error_description: "Denied by user",
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        );
      });
    const outcome = await cloudSession.authorize("choose");
    expect(outcome).toMatchObject({
      ok: false,
      problem: { code: "access_denied" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request!.get("operations")!.split(",")).toEqual(expectedOperations);
    const proof = JSON.parse(request!.get("application_authorization")!);
    expect(proof.binding).toMatchObject({
      contracts: { semantic_capabilities: 2 },
      requested_operations: expectedOperations,
      requested_files: {
        actions: bundledManifest.requirements.files.required,
        scope: bundledManifest.requirements.files.scope,
      },
    });
    expect(cloudSession.getSnapshot().status).toBe("unselected");
  });

  it("registers the generated declaration inline", () => {
    expect(registrationRequestBody).toEqual({
      manifest: bundledManifest,
    });
  });

  it("authorizes another collection with an explicit choose intent", async () => {
    const authorize = vi
      .spyOn(cloudConnect, "authorize")
      .mockResolvedValue(connectSuccess({ kind: "redirecting" }));

    await cloudSession.authorize("choose");

    expect(authorize.mock.calls[0][0]).not.toHaveProperty("operations");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "choose" },
        returnTo: "/",
      }),
    );
  });

  it("authorizes an exact newly adopted collection", async () => {
    const authorize = vi
      .spyOn(cloudConnect, "authorize")
      .mockResolvedValue(connectSuccess({ kind: "redirecting" }));

    await cloudSession.authorize({ collectionId: "hosted-after-adoption" });

    expect(authorize.mock.calls[0][0]).not.toHaveProperty("operations");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          kind: "collection",
          collectionId: "hosted-after-adoption",
        },
        returnTo: "/",
      }),
    );
  });
});
