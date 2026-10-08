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
