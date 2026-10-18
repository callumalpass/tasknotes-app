import { expect, it } from "vitest";
import {
  personSettingsUrl,
  requirePersonEditorOrigin,
} from "./person-settings-url";

it.each(["https://editor.example.test", "http://127.0.0.1:48219"])(
  "accepts explicit canonical Editor origin %s",
  (origin) => expect(requirePersonEditorOrigin(origin)).toBe(origin),
);

it.each([
  undefined,
  null,
  "",
  "javascript:alert(1)",
  "http://editor.example.test",
  "http://127.0.0.1",
  "http://127.0.0.1:0",
  "http://127.0.0.1.example.test:48219",
  "https://user:password@editor.example.test",
  "https://editor.example.test/",
  "https://editor.example.test/settings",
  "https://editor.example.test?server=elsewhere",
  "https://editor.example.test#your-person",
])("refuses missing or noncanonical Editor configuration %s", (value) => {
  expect(() => requirePersonEditorOrigin(value)).toThrow(
    "VITE_TASKNOTES_EDITOR_ORIGIN",
  );
});

it("retains authority metadata only for consumers without next build configuration", () => {
  const href = "https://editor.example.test/?surface=settings#your-person";
  expect(personSettingsUrl(href, undefined)).toBe(href);
  expect(() => personSettingsUrl(href, "")).toThrow(
    "VITE_TASKNOTES_EDITOR_ORIGIN",
  );
});
