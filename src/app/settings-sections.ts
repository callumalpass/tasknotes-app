import { t } from "@lingui/core/macro";
export const SETTINGS_SECTIONS = [
  "collection",
  "account",
  "reminders",
  "device",
  "behavior",
  "about",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const settingsSectionLabels: Record<SettingsSection, string> = {
  get collection() {
    return t({ message: "Collection" });
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
  get behavior() {
    return t({ message: "Collection behavior" });
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
