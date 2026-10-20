import { describe, expect, it } from "vitest";
import {
  requireTaskNotesAppEnvironment,
  TASKNOTES_LAB_ORIGIN,
  TASKNOTES_PRODUCTION_ORIGIN,
  TASKNOTES_STAGING_ORIGIN,
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
  it("targets the exact staging address without a second-origin input", () => {
    expect(TASKNOTES_STAGING_ORIGIN).toBe(
      "https://staging.tasknotes-app.pages.dev",
    );
    const environment = requireTaskNotesAppEnvironment(
      "staging",
      undefined,
      TASKNOTES_STAGING_ORIGIN,
    );
    expect(environment).toEqual({
      environment: "staging",
      appOrigin: TASKNOTES_STAGING_ORIGIN,
    });
    expect(Object.isFrozen(environment)).toBe(true);
    expect(
      requireTaskNotesAppEnvironment("staging", "", TASKNOTES_STAGING_ORIGIN),
    ).toEqual({
      environment: "staging",
      appOrigin: TASKNOTES_STAGING_ORIGIN,
    });
  });
  it.each([
    TASKNOTES_LAB_ORIGIN,
    TASKNOTES_PRODUCTION_ORIGIN,
    "https://lab.tasknotes-app.pages.dev",
    "https://other.example.test",
  ])("refuses wrong staging page %s", (origin) => {
    expect(() =>
      requireTaskNotesAppEnvironment("staging", undefined, origin),
    ).toThrow();
  });
  it("never carries LAB input into staging", () => {
    expect(() =>
      requireTaskNotesAppEnvironment(
        "staging",
        TASKNOTES_LAB_ORIGIN,
        TASKNOTES_STAGING_ORIGIN,
      ),
    ).toThrow();
    expect(() =>
      requireTaskNotesAppEnvironment(
        "staging",
        TASKNOTES_STAGING_ORIGIN,
        TASKNOTES_STAGING_ORIGIN,
      ),
    ).toThrow();
  });
  it.each([undefined, "", "LAB", "STAGING", "unknown"])(
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
    TASKNOTES_STAGING_ORIGIN,
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
  it("binds a public HTTPS LAB preview to its exact configured origin", () => {
    const origin = "https://lab.tasknotes-app.pages.dev";
    expect(requireTaskNotesAppEnvironment("lab", origin, origin)).toEqual({
      environment: "lab",
      appOrigin: origin,
    });
    expect(() =>
      requireTaskNotesAppEnvironment("lab", origin, "https://other.pages.dev"),
    ).toThrow();
  });
  it.each([
    "https://lab.tasknotes-app.pages.dev/",
    "https://lab.tasknotes-app.pages.dev:8443",
    "https://user@lab.tasknotes-app.pages.dev",
    "https://203.0.113.7",
    TASKNOTES_PRODUCTION_ORIGIN,
    TASKNOTES_STAGING_ORIGIN,
  ])("refuses a noncanonical or production HTTPS LAB origin: %s", (origin) => {
    expect(() =>
      requireTaskNotesAppEnvironment("lab", origin, origin),
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
