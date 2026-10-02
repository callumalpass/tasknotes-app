import { expect, it, vi } from "vitest";
import {
  MdbaseApplicationSession,
  MdbaseMemorySelection,
  operationsForApplicationCapabilities,
  type ConnectRequestOptions,
  type JsonObject,
  type MdbaseAppManifest,
  type MdbaseConnectionInfo,
} from "@mdbase-dev/connect";
import { MdbaseCollectionClient } from "@mdbase-dev/connect/advanced";
import { deferred } from "../test/mdbase-fixture";
import bundledManifest from "../generated/mdbase-app.json";

// The public SDK session runs over a synthetic authority. A connector's
// direct-access status can change while its relay setup assessment is in flight.
it.each(["cancellation", "programming error"])(
  "reconciles a superseded assessment's %s without hiding programming faults",
  async (failure) => {
    const manifest = bundledManifest as MdbaseAppManifest;
    const collectionId = "01922222-2222-7222-8222-222222222222";
    const applicationId = "01922222-2222-7222-8222-222222222221";
    const capabilities = manifest.requirements!.capabilities!;
    if (capabilities.contract_version !== 2)
      throw new Error("Expected v2 declaration");
    const operations = [
      ...operationsForApplicationCapabilities(capabilities),
      "assess_collection_setup" as const,
      "apply_collection_setup" as const,
    ];
    let info: MdbaseConnectionInfo = {
      collectionId,
      displayName: "Relay tasks",
      operations,
      scope: { contracts: [], access: "full_collection" },
      fileCapability: {
        kind: "files",
        protocol_version: 1,
        actions: ["list", "read", "add", "replace", "move", "delete"],
        scope: { kind: "collection" },
      },
      authority: { kind: "connector", durability: "computer" },
      route: "relay",
      directAccess: "checking",
    };
    let connectionChanged:
      ((info: MdbaseConnectionInfo | null) => void) | undefined;
    const assessing = deferred<void>();
    const cancelled = vi.fn();
    const programmingError = new Error("Broken assessment invariant");
    let assessments = 0;
    const client = new MdbaseCollectionClient<JsonObject>({
      operation: async <Result>(
        operation: string,
        input: unknown,
        options?: ConnectRequestOptions,
      ): Promise<Result> => {
        if (operation === "describe")
          return {
            protocol_version: 1,
            collection_id: collectionId,
            display_name: info.displayName,
            spec_version: "0.3.0",
            operations,
            change_cursor: 0,
            types: [],
            contracts: manifest.requirements!.contracts.map((contract) => ({
              contract_type: "record",
              ...contract,
              schema: {},
              implementations: [],
            })),
          } as Result;
        if (operation !== "assess_collection_setup")
          throw new Error(`Unexpected operation: ${operation}`);
        if (++assessments === 1) {
          // Model fetch's raw DOMException, rather than an already normalized SDK failure.
          return new Promise((_resolve, reject) => {
            options!.signal!.addEventListener(
              "abort",
              () => {
                cancelled(options!.signal!.reason);
                reject(
                  failure === "cancellation"
                    ? options!.signal!.reason
                    : programmingError,
                );
              },
              { once: true },
            );
            assessing.resolve();
          });
        }
        const request = input as JsonObject;
        const digest = `sha256:${"a".repeat(64)}`;
        return {
          valid: true,
          diagnostics: [],
          result: {
            status: "current",
            applicable: true,
            application_id: request.application_id,
            declaration_digest: request.declaration_digest,
            provision_digest: digest,
            collection_revision: digest,
            final_collection_revision: digest,
            configuration: [],
            type_packs: [],
            final_resource_revisions: {},
            assessment_digest: digest,
          },
        } as Result;
      },
    });
    const connection = Object.assign(client, {
      collectionId,
      operations,
      info: () => info,
      authorizationCapabilities: () => ({
        authorized: true,
        sufficient: true,
        collectionId,
        grantedOperations: operations,
        missingOperations: [],
      }),
      onConnectionChange: (listener: typeof connectionChanged) => {
        connectionChanged = listener;
        return () => {
          connectionChanged = undefined;
        };
      },
    });
    const facade = {
      register: async () => ({
        ok: true,
        value: {
          id: applicationId,
          family_identity: `bundle:${manifest.id}`,
          manifest_digest: "0".repeat(64),
          requirements: manifest.requirements,
        },
      }),
      manifest: async () => ({ ok: true, value: manifest }),
      connections: () => [info],
      connection: () => connection,
      connectionApplicationId: () => applicationId,
      onConnectionsChange: () => () => undefined,
    };
    const selection = new MdbaseMemorySelection();
    selection.select(collectionId);
    const session = new MdbaseApplicationSession(facade as never, {
      selection,
      autoSelect: "never",
    });
    try {
      const opening = session.start();
      // Attach rejection handling before triggering the old SDK's startup failure.
      const result =
        failure === "cancellation"
          ? expect(opening).resolves.toMatchObject({ ok: true })
          : expect(opening).rejects.toBe(programmingError);
      await assessing.promise;
      info = { ...info, directAccess: "unavailable" };
      connectionChanged!(info);
      await result;
      if (failure === "cancellation") {
        await vi.waitFor(() =>
          expect(session.getSnapshot()).toMatchObject({
            status: "ready",
            verification: "verified",
          }),
        );
        expect(session.connection()).toBe(connection);
      }
      expect(assessments).toBe(2);
      expect(cancelled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: "AbortError" }),
      );
    } finally {
      session.destroy();
    }
  },
);
