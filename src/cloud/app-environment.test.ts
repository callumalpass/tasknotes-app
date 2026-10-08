import { describe, expect, it } from "vitest";
import {
  requireTaskNotesAppEnvironment,
  TASKNOTES_LAB_ORIGIN,
  TASKNOTES_PRODUCTION_ORIGIN,
} from "./app-environment";

describe("explicit next-only replace-at-cutover build environment", () => {
  it("targets the existing same-origin production address without a second-origin input", () => {
    expect(
      requireTaskNotesAppEnvironment(
        "production",
        undefined,
        TASKNOTES_PRODUCTION_ORIGIN,
      ),
    ).toEqual({
      environment: "production",
      appOrigin: TASKNOTES_PRODUCTION_ORIGIN,
    });
    expect(
      Object.isFrozen(
        requireTaskNotesAppEnvironment(
          "production",
          "",
          TASKNOTES_PRODUCTION_ORIGIN,
        ),
      ),
    ).toBe(true);
  });
  it.each([undefined, "", "staging", "LAB", "unknown"])(
    "refuses missing/ambiguous environment %s",
    (environment) => {
      expect(() =>
        requireTaskNotesAppEnvironment(
          environment,
          undefined,
          TASKNOTES_PRODUCTION_ORIGIN,
        ),
      ).toThrow();
    },
  );
  it.each([
    TASKNOTES_LAB_ORIGIN,
    "https://next.tasknotes.dev",
    "https://other.example.test",
  ])("refuses wrong production page %s", (origin) => {
    expect(() =>
      requireTaskNotesAppEnvironment("production", undefined, origin),
    ).toThrow();
  });
  it("never carries LAB input into production", () => {
    expect(() =>
      requireTaskNotesAppEnvironment(
        "production",
        TASKNOTES_LAB_ORIGIN,
        TASKNOTES_PRODUCTION_ORIGIN,
      ),
    ).toThrow();
  });
  it("admits only the explicit isolated LAB host/port", () => {
    expect(
      requireTaskNotesAppEnvironment(
        "lab",
        TASKNOTES_LAB_ORIGIN,
        TASKNOTES_LAB_ORIGIN,
      ),
    ).toEqual({ environment: "lab", appOrigin: TASKNOTES_LAB_ORIGIN });
  });
  it.each([
    undefined,
    "",
    "http://localhost:48218",
    "http://127.0.0.1:48219",
    `${TASKNOTES_LAB_ORIGIN}/`,
    "https://127.0.0.1:48218",
    TASKNOTES_PRODUCTION_ORIGIN,
  ])("refuses missing/changed LAB input %s", (origin) => {
    expect(() =>
      requireTaskNotesAppEnvironment("lab", origin, TASKNOTES_LAB_ORIGIN),
    ).toThrow();
  });
  it("refuses LAB build on production origin", () => {
    expect(() =>
      requireTaskNotesAppEnvironment(
        "lab",
        TASKNOTES_LAB_ORIGIN,
        TASKNOTES_PRODUCTION_ORIGIN,
      ),
    ).toThrow();
  });
});
