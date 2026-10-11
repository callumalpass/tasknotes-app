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
  it("binds a separate LAB build to its exact configured loopback port", () => {
    const origin = "http://127.0.0.1:48220";
    const environment = requireTaskNotesAppEnvironment("lab", origin, origin);
    expect(environment).toEqual({ environment: "lab", appOrigin: origin });
    expect(Object.isFrozen(environment)).toBe(true);
    expect(() =>
      requireTaskNotesAppEnvironment("lab", origin, TASKNOTES_LAB_ORIGIN),
    ).toThrow();
  });
  it.each([
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:048220",
    "http://user@127.0.0.1:48220",
    "http://127.0.0.1:48220/path",
    "http://127.0.0.1:48220?mode=lab",
    "http://127.0.0.1:48220#lab",
    "http://127.0.0.1.example.test:48220",
  ])(
    "refuses noncanonical LAB configuration even at the same origin: %s",
    (origin) => {
      expect(() =>
        requireTaskNotesAppEnvironment("lab", origin, origin),
      ).toThrow();
    },
  );
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
