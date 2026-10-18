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
  collection: "Collection",
  account: "Account",
  reminders: "Reminders",
  device: "On this device",
  behavior: "Collection behavior",
  about: "About & help",
};

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function settingsSectionId(section: SettingsSection): string {
  return `settings-${section}`;
}
