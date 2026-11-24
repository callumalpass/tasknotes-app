import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Capacitor } from "@capacitor/core";
import {
  mcpSetupUrl,
  mdbaseAppHref,
  officialApps,
  withAppUrls,
  type OfficialApp,
  type OfficialAppId,
} from "@mdbase-dev/ui/apps";
import { MdbaseAppMark } from "@mdbase-dev/ui/brand";
import { Menu, useMenuTrigger } from "@mdbase-dev/ui/menu";
import type { JSX } from "react";

import { tasknotesMarkUrl } from "../app/assets";
import {
  TASKNOTES_PRODUCTION_ORIGIN,
  TASKNOTES_STAGING_ORIGIN,
} from "../cloud/app-environment";

const SDK_DOCUMENTATION_URL = "https://mdbase.dev/sdk/";

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

function appHref(
  appUrl: string,
  currentHref: string,
  collectionId?: string | null,
): string {
  const target = new URL(mdbaseAppHref(appUrl, currentHref));
  if (collectionId) target.searchParams.set("collection", collectionId);
  return target.href;
}

/**
 * Displays the shared mdbase app switcher popup from TaskNotes' wordmark button.
 *
 * TODO(@mdbase-dev/ui >= 0.2.2): replace this wrapper with
 * `<AppSwitcher current="tasknotes" urls={...} collectionId={...} align="start" className="wordmark">`
 * from `@mdbase-dev/ui/app-switcher` once published and pinned, and remove the
 * duplicated app-switcher strings from TaskNotes' PO catalogues.
 */
export function TaskNotesAppSwitcher({
  collectionId,
  urls = taskNotesAppUrls(),
}: {
  readonly collectionId?: string | null;
  readonly urls?: Partial<Record<OfficialAppId, string | undefined>>;
}): JSX.Element {
  useLingui();
  const { id, open, close, trigger, triggerProps } = useMenuTrigger();
  const apps = withAppUrls(urls, officialApps);
  const hasCollection =
    Boolean(collectionId) ||
    new URL(window.location.href).searchParams.has("collection");
  const heading = hasCollection
    ? t({ message: "Open this collection in" })
    : t({ message: "mdbase apps" });

  return (
    <>
      <button
        {...triggerProps}
        className="mdbase-app-switcher wordmark"
        title={t({ message: "Open in another mdbase app" })}
        type="button"
      >
        <img alt="" src={tasknotesMarkUrl} />
        <span>TaskNotes</span>
        <svg
          aria-hidden="true"
          className="mdbase-app-switcher-chevron"
          viewBox="0 0 24 24"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      <Menu
        id={id}
        label={t({ message: "mdbase apps" })}
        open={open}
        triggerRef={trigger}
        onClose={close}
      >
        <div className="mdbase-menu-heading" role="presentation">
          {heading}
        </div>
        <div className="mdbase-menu-list">
          {apps.map((app) => (
            <AppItem
              key={app.id}
              app={app}
              collectionId={collectionId}
              current={app.id === "tasknotes"}
              onOpen={() => close(false)}
            />
          ))}
        </div>
        {apps.length > 0 ? (
          <div className="mdbase-menu-divider" role="separator" />
        ) : null}
        <div className="mdbase-menu-list">
          <a
            className="mdbase-menu-item"
            href={mcpSetupUrl}
            rel="noopener"
            role="menuitem"
            target="_blank"
            onClick={() => close(false)}
          >
            <svg
              aria-hidden="true"
              className="mdbase-app-menu-mark mdbase-app-menu-mcp-mark"
              focusable="false"
              viewBox="0 0 24 24"
            >
              <circle cx="6.5" cy="12" r="2.25" />
              <circle cx="17.5" cy="6.5" r="2.25" />
              <circle cx="17.5" cy="17.5" r="2.25" />
              <path d="M8.5 11 15.5 7.5M8.5 13l7 3.5" />
            </svg>
            <span className="mdbase-menu-copy">
              <strong>{t({ message: "AI clients (MCP)" })}</strong>
              <small>{t({ message: "Claude, ChatGPT and Codex" })}</small>
            </span>
            <ExternalIcon />
            <span className="mdbase-visually-hidden">
              {"  "}
              {t({ message: "(opens in a new tab)" })}
            </span>
          </a>
        </div>
        <div className="mdbase-menu-note mdbase-app-menu-footer">
          <span>{t({ message: "Opens in a new tab" })}</span>
          <a
            className="mdbase-app-menu-build"
            href={SDK_DOCUMENTATION_URL}
            rel="noopener"
            role="menuitem"
            target="_blank"
            onClick={() => close(false)}
          >
            {t({ message: "Build your own" })}
            <span className="mdbase-visually-hidden">
              {"  "}
              {t({ message: "(opens in a new tab)" })}
            </span>
          </a>
        </div>
      </Menu>
    </>
  );
}

function ExternalIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="mdbase-app-menu-external"
      viewBox="0 0 24 24"
    >
      <path d="M10 5.5H5.5v13h13V14M13.5 5.5h5v5M18.5 5.5 11 13" />
    </svg>
  );
}

function AppItem({
  app,
  current,
  collectionId,
  onOpen,
}: {
  readonly app: OfficialApp;
  readonly current: boolean;
  readonly collectionId?: string | null;
  readonly onOpen: () => void;
}): JSX.Element {
  useLingui();
  const copy = (
    <>
      <MdbaseAppMark app={app.id} className="mdbase-app-menu-mark" />
      <span className="mdbase-menu-copy">
        <strong>{app.name}</strong>
        <small>{app.description}</small>
      </span>
    </>
  );
  if (current) {
    return (
      <div
        aria-current="page"
        aria-disabled="true"
        className="mdbase-menu-item is-current"
        role="menuitem"
        tabIndex={-1}
      >
        {copy}
        <span className="mdbase-app-menu-current">
          {t({ message: "Current" })}
        </span>
      </div>
    );
  }
  return (
    <a
      className="mdbase-menu-item"
      href={appHref(app.url, window.location.href, collectionId)}
      rel="noopener"
      role="menuitem"
      target="_blank"
      onClick={onOpen}
    >
      {copy}
      <ExternalIcon />
      <span className="mdbase-visually-hidden">
        {"  "}
        {t({ message: "(opens in a new tab)" })}
      </span>
    </a>
  );
}
