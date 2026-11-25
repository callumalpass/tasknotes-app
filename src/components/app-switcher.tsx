import { Capacitor } from "@capacitor/core";
import { AppSwitcher } from "@mdbase-dev/ui/app-switcher";
import type { OfficialAppId } from "@mdbase-dev/ui/apps";
import type { JSX, RefObject } from "react";

import { tasknotesMarkUrl } from "../app/assets";
import {
  TASKNOTES_PRODUCTION_ORIGIN,
  TASKNOTES_STAGING_ORIGIN,
} from "../cloud/app-environment";

const MANAGED_APP_ORIGINS = {
  production: {
    editor: "https://editor.mdbase.dev",
    reader: "https://reader.mdbase.dev",
    writer: "https://writer.mdbase.dev",
    journal: "https://journal.mdbase.dev",
    tasknotes: TASKNOTES_PRODUCTION_ORIGIN,
  },
  staging: {
    editor: "https://editor-staging.mdbase.dev",
    reader: "https://staging.mdbase-reader.pages.dev",
    writer: "https://staging.mdbase-writer.pages.dev",
    journal: "https://staging.mdbase-journal.pages.dev",
    tasknotes: TASKNOTES_STAGING_ORIGIN,
  },
  lab: {
    editor: "https://editor-lab.mdbase.dev",
    reader: "https://lab.mdbase-reader.pages.dev",
    writer: "https://lab.mdbase-writer.pages.dev",
    journal: "https://lab.mdbase-journal-lab.pages.dev",
    tasknotes: "https://lab.tasknotes-app.pages.dev",
  },
} as const;

export function taskNotesAppUrls(
  environment: string | undefined = import.meta.env.VITE_TASKNOTES_ENVIRONMENT,
  editorOrigin: string | undefined = import.meta.env
    .VITE_TASKNOTES_EDITOR_ORIGIN,
  labOrigin: string | undefined = import.meta.env.VITE_TASKNOTES_LAB_ORIGIN,
): Record<OfficialAppId, string> {
  const key: keyof typeof MANAGED_APP_ORIGINS =
    environment === "production" || environment === "staging"
      ? environment
      : "lab";
  const base = MANAGED_APP_ORIGINS[key];
  return {
    ...base,
    editor: editorOrigin || base.editor,
    tasknotes: key === "lab" && labOrigin ? labOrigin : base.tasknotes,
  };
}

/**
 * Self-hosted deployments have no hosted mdbase app fleet, and iOS hides links
 * that lead to mdbase's external web plans (App Store guideline 3.1.1).
 */
export function canShowAppSwitcher(
  mode = import.meta.env.MODE,
  native = Capacitor.isNativePlatform(),
  platform = Capacitor.getPlatform(),
): boolean {
  if (mode === "self-hosted") return false;
  if (native && platform === "ios") return false;
  return true;
}

/** The shared mdbase app switcher, triggered by TaskNotes' own mark and name. */
export function TaskNotesAppSwitcher({
  collectionId,
  urls = taskNotesAppUrls(),
}: {
  readonly collectionId?: string | null;
  readonly urls?: Partial<Record<OfficialAppId, string | undefined>>;
}): JSX.Element {
  return (
    <AppSwitcher
      className="wordmark"
      collectionId={collectionId}
      current="tasknotes"
      urls={urls}
    >
      <img alt="" src={tasknotesMarkUrl} />
      <span>TaskNotes</span>
    </AppSwitcher>
  );
}

/**
 * The same mdbase apps menu without its wordmark trigger, for phones, where the
 * navigation rail and its wordmark are hidden. The bottom navigation's More menu
 * opens it, and it opens against `anchorRef`.
 */
export function TaskNotesAppsMenu({
  anchorRef,
  collectionId,
  open,
  onOpenChange,
}: {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly collectionId?: string | null;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  return (
    <AppSwitcher
      align="end"
      anchorRef={anchorRef}
      collectionId={collectionId}
      current="tasknotes"
      open={open}
      urls={taskNotesAppUrls()}
      variant="none"
      onOpenChange={onOpenChange}
    />
  );
}
