import { describe, expect, it, vi } from "vitest";

// Simulate the immutable Vite local-rehearsal build constant, not a runtime
// environment setting. The real compiled artifact is checked separately.
vi.mock("./local-build", () => ({ LOCAL_TASKNOTES_BUILD: true }));
import { requireTaskNotesAppEnvironment } from "./app-environment";
import { requirePersonEditorOrigin } from "./person-settings-url";
const origin = "http://127.0.0.1:48271";

describe("compiled local TaskNotes environment", () => {
  it("admits only local plus its exact explicitly configured app origin", () => {
    const value = requireTaskNotesAppEnvironment(
      "local",
      undefined,
      origin,
      origin,
    );
    expect(value).toEqual({ environment: "local", appOrigin: origin });
    expect(Object.isFrozen(value)).toBe(true);
    expect(() =>
      requireTaskNotesAppEnvironment(
        "local",
        undefined,
        "http://127.0.0.1:48273",
        origin,
      ),
    ).toThrow();
    expect(() =>
      requireTaskNotesAppEnvironment("local", origin, origin, origin),
    ).toThrow();
  });
  it.each(["lab", "production", "staging", undefined])(
    "refuses managed selection %s",
    (environment) => {
      expect(() =>
        requireTaskNotesAppEnvironment(environment, undefined, origin, origin),
      ).toThrow();
    },
  );
  it.each([
    undefined,
    "",
    "https://lab.tasknotes-app.pages.dev",
    "http://localhost:48271",
    "http://127.1:48271",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    origin + "/",
    origin + "/path",
    "http://user@127.0.0.1:48271",
  ])("refuses noncanonical app/Editor origin %s", (candidate) => {
    expect(() =>
      requireTaskNotesAppEnvironment("local", undefined, origin, candidate),
    ).toThrow();
    expect(() => requirePersonEditorOrigin(candidate)).toThrow();
  });
  it("requires a loopback Editor without selecting a managed fallback", () => {
    expect(requirePersonEditorOrigin("http://127.0.0.1:48272")).toBe(
      "http://127.0.0.1:48272",
    );
  });
});
