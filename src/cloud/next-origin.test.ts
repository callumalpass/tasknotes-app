import { describe, expect, it } from "vitest";
import { NEXT_ORIGIN_CONFIG_KEY, requireNextAppOrigin } from "./next-origin";

const origin = "https://next-app.example.test";
describe("next app origin configuration", () => {
  it.each([undefined, null, "", "__APPROVED_NEXT_ORIGIN_REQUIRED__"])(
    "never supplies a default for %j",
    (value) =>
      expect(() => requireNextAppOrigin(value, origin)).toThrow(
        NEXT_ORIGIN_CONFIG_KEY,
      ),
  );
  it.each([
    "http://next-app.example.test",
    "https://app.tasknotes.dev",
    `${origin}/`,
    `${origin}/callback`,
    `${origin}?token=anything`,
    `${origin}#fragment`,
    "https://user:password@next-app.example.test",
  ])("refuses a legacy or noncanonical origin %s", (value) => {
    expect(() => requireNextAppOrigin(value, origin)).toThrow();
  });
  it("requires the actual page origin to match", () => {
    expect(() =>
      requireNextAppOrigin(origin, "https://other.example.test"),
    ).toThrow();
    expect(requireNextAppOrigin(origin, origin)).toBe(origin);
  });
});
