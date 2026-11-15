import { t } from "@lingui/core/macro";
export const SETTINGS_SECTIONS = [
  "collection",
  "properties",
  "behavior",
  "reminders",
  "device",
  "account",
  "about",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Sections are listed in clusters by who they affect: the shared collection,
 * then this person and device, then the app itself.
 */
export const SETTINGS_SECTION_GROUPS: readonly (readonly SettingsSection[])[] =
  [
    ["collection", "properties", "behavior"],
    ["reminders", "device", "account"],
    ["about"],
  ];

export const settingsSectionLabels: Record<SettingsSection, string> = {
  get collection() {
    return t({ message: "Collection" });
  },
  get properties() {
    return t({ message: "Task properties" });
  },
  get behavior() {
    return t({
      message: "Workflow",
      comment:
        "Settings section: how the collection handles new, repeating, and archived tasks",
    });
  },
  get account() {
    return t({ message: "Account" });
  },
  get reminders() {
    return t({ message: "Reminders" });
  },
  get device() {
    return t({ message: "On this device" });
  },
  get about() {
    return t({ message: "About & help" });
  },
};

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function settingsSectionId(section: SettingsSection): string {
  return `settings-${section}`;
}
