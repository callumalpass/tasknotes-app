import { describe, it, expect } from "vitest";
import {
  isNextInstallationCommand,
  installationErrorCode,
  isInstallationErrorCode,
} from "./next-installation-protocol";
describe("native installation Worker public protocol (source only)", () => {
  it("accepts only fixed commands, never a generic method/host/custody getter", () => {
    for (const kind of [
      "start",
      "renew-expired",
      "exchange",
      "attest",
      "collections",
      "exchange-consent",
      "close",
    ])
      expect(isNextInstallationCommand({ kind })).toBe(true);
    for (const command of [
      null,
      [],
      { kind: "getKeys" },
      { kind: "start", token: "not allowed" },
      { kind: "exchange", retry: true },
      { kind: "renew-expired", actor: "fresh" },
      { kind: "renew-expired", requestId: "caller-supplied" },
      { kind: "collections", accountId: "foreign" },
    ])
      expect(isNextInstallationCommand(command)).toBe(false);
  });
  it("requires explicit original mode and boolean create request", () => {
    expect(
      isNextInstallationCommand({
        kind: "open",
        build: {},
        mode: "fresh",
        requestedCreateCollections: false,
      }),
    ).toBe(true);
    expect(
      isNextInstallationCommand({ kind: "open", build: {}, mode: "existing" }),
    ).toBe(true);
    for (const command of [
      { kind: "open", build: {}, mode: "automatic" },
      { kind: "open", build: {}, mode: "fresh", requestedCreateCollections: 1 },
      { kind: "start-consent", requestedCreateCollections: "true" },
      {
        kind: "start-consent",
        requestedCreateCollections: true,
        collectionIds: [],
      },
    ])
      expect(isNextInstallationCommand(command)).toBe(false);
    expect(
      isNextInstallationCommand({
        kind: "start-consent",
        requestedCreateCollections: false,
      }),
    ).toBe(true);
  });
  it("requires bounded account reference and no extra authority", () => {
    expect(
      isNextInstallationCommand({
        kind: "confirm-account",
        accountId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
    expect(
      isNextInstallationCommand({ kind: "confirm-account", accountId: "" }),
    ).toBe(false);
    expect(
      isNextInstallationCommand({
        kind: "confirm-account",
        accountId: "11111111-1111-4111-8111-111111111111",
        grant: "no",
      }),
    ).toBe(false);
  });
  it("creation carries only explicit recovery intent, never a caller-selected target or authority", () => {
    expect(
      isNextInstallationCommand({
        kind: "create-collection",
        reconcile: false,
      }),
    ).toBe(true);
    expect(
      isNextInstallationCommand({ kind: "create-collection", reconcile: true }),
    ).toBe(true);
    for (const command of [
      { kind: "create-collection" },
      { kind: "create-collection", reconcile: "true" },
      {
        kind: "create-collection",
        reconcile: true,
        collectionId: "replacement",
      },
      { kind: "create-collection", reconcile: false, grant: "owner" },
    ])
      expect(isNextInstallationCommand(command)).toBe(false);
  });
  it("accepts fixed original model journal actions without generic storage or caller-selected scope", () => {
    const ops = [
      {
        kind: "resource_put",
        path: "_contracts/tasknotes.task.md",
        doc: "Inline contract",
        mustNotExist: true,
      },
      {
        kind: "resource_put",
        path: "_types/task.md",
        doc: "Inline type",
        mustNotExist: true,
      },
    ];
    expect(
      isNextInstallationCommand({ kind: "model-setup-intent", action: "load" }),
    ).toBe(true);
    expect(
      isNextInstallationCommand({
        kind: "model-setup-intent",
        action: "prepare",
        ops,
      }),
    ).toBe(true);
    for (const action of ["attempt", "confirm", "verify"])
      expect(
        isNextInstallationCommand({
          kind: "model-setup-intent",
          action,
          mutationId: "11111111-1111-4111-8111-111111111111",
        }),
      ).toBe(true);
    expect(isNextInstallationCommand({ kind: "model-setup-verified" })).toBe(
      true,
    );
    for (const command of [
      { kind: "model-setup-intent", action: "load", scope: {} },
      { kind: "model-setup-intent", action: "save", value: {} },
      { kind: "model-setup-intent", action: "remove" },
      { kind: "model-setup-intent", action: "prepare", ops: [ops[0]] },
      { kind: "model-setup-intent", action: "prepare", ops, key: "no-loan" },
      {
        kind: "model-setup-intent",
        action: "attempt",
        mutationId: "replacement",
      },
      { kind: "model-setup-verified", collection: "caller-selected" },
    ])
      expect(isNextInstallationCommand(command)).toBe(false);
  });
  it("errors are finite public codes, never raw messages or an arbitrary lower-case string", () => {
    for (const reason of [
      "binding",
      "busy",
      "recovery_required",
      "outcome_unknown",
      "fenced",
      "refused",
      "response",
    ])
      expect(installationErrorCode({ reason })).toBe(reason);
    for (const reason of [
      "a".repeat(64),
      "opaqueprivatevalue",
      "Bearer forbidden",
      {},
      null,
    ]) {
      expect(isInstallationErrorCode(reason)).toBe(false);
      expect(installationErrorCode({ reason })).toBe("unavailable");
    }
    expect(
      installationErrorCode(
        new Error("private transport body must not cross Worker boundary"),
      ),
    ).toBe("unavailable");
  });
});
