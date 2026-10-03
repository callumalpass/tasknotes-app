import { describe, expect, it, vi } from "vitest";

// Reproduce the deployed rc.3 App receiving the actual rc.5 collection error.
vi.mock("../generated/mdbase-app.json", () => ({
  default: {
    requirements: {
      contracts: [{ id: "tasknotes.task", version: "0.3.0-rc.3" }],
    },
  },
}));

import {
  collectionErrorMessage,
  NEWER_TASKNOTES_COLLECTION_MESSAGE,
} from "./collection-error";

import capturedDiagnostic from "../../tests/fixtures/mdbase-upgrades/older-app-setup-error.txt?raw";

const captured = capturedDiagnostic.trim();

describe("newer collection setup guidance", () => {
  it("replaces the captured engine debug object with App-update guidance", () => {
    expect(collectionErrorMessage(new Error(captured))).toBe(
      NEWER_TASKNOTES_COLLECTION_MESSAGE,
    );
  });
  it("handles structured Connect problems and native callback failures", () => {
    expect(
      collectionErrorMessage({
        problem: {
          code: "data_contract_version_mismatch",
          message:
            "Type 'task' requires data contract 'tasknotes.task' 0.3.0-rc.5, but no registered version satisfies it",
        },
      }),
    ).toBe(NEWER_TASKNOTES_COLLECTION_MESSAGE);
  });
  it.each(["0.3.0-rc.2", "0.3.0-rc.3"])(
    "does not call %s a newer App requirement",
    (version) => {
      const message = captured.replace("0.3.0-rc.5", version);
      expect(collectionErrorMessage(new Error(message))).toBe(message);
    },
  );
  it("does not disguise unrelated contracts or pack validation failures", () => {
    const other = captured.replace("tasknotes.task", "other.task");
    expect(collectionErrorMessage(new Error(other))).toBe(other);
    expect(collectionErrorMessage(new Error("Invalid type schema"))).toBe(
      "Invalid type schema",
    );
  });
});
