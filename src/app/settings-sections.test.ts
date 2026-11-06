import { expect, it } from "vitest";
import { visibleSettingsSection } from "./settings-sections";

it("resolves the first section again after scrolling back from device settings", () => {
  expect(
    visibleSettingsSection(
      [
        { key: "collection", top: -600 },
        { key: "reminders", top: -200 },
        { key: "device", top: 70 },
      ],
      713,
    ),
  ).toBe("device");
  expect(
    visibleSettingsSection(
      [
        { key: "collection", top: 100 },
        { key: "reminders", top: 500 },
        { key: "device", top: 900 },
      ],
      713,
    ),
  ).toBe("collection");
});

it("keeps the current section through gaps and scales the boundary to short viewports", () => {
  expect(
    visibleSettingsSection(
      [
        { key: "collection", top: -400 },
        { key: "reminders", top: 130 },
      ],
      713,
    ),
  ).toBe("collection");
  expect(
    visibleSettingsSection(
      [
        { key: "collection", top: -400 },
        { key: "reminders", top: 80 },
      ],
      300,
    ),
  ).toBe("collection");
});
