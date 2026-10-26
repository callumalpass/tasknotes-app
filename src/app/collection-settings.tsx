import { appLocale } from "../i18n/app";
import { ChevronDown, ChevronUp, Cloud } from "lucide-react";
import { useState } from "react";
import { useLingui, Trans, Plural } from "@lingui/react/macro";
import { useCollectionGate } from "./collection-context";
import { useCollectionSummary, useRepository } from "./repository-context";

/** Uses the application-level Lingui provider. */
export function CollectionSettings() {
  return <CollectionSettingsContent />;
}

export function CollectionSettingsContent() {
  const { t } = useLingui();
  const { info, stats, loading } = useCollectionSummary();
  const { connection, lastRefresh, refresh, refreshing } = useRepository();
  const { changeCollection } = useCollectionGate();
  const [showLocation, setShowLocation] = useState(false);
  const open = stats?.open ?? 0;
  const total = stats?.total ?? 0;
  const scanned = lastRefresh?.scanned ?? 0;
  const elapsed = lastRefresh?.elapsedMs.toLocaleString(appLocale()) ?? "0";
  const connectionLabel =
    connection.state === "connecting"
      ? t`Connecting`
      : connection.state === "unavailable"
        ? t`Collection unavailable`
        : t`Connected`;
  return (
    <section
      className="settings-section"
      aria-labelledby="collection-settings-title"
    >
      <h2 id="collection-settings-title">
        {t({
          message: "Collection",
          context: "settings section title",
          comment:
            "The selected mdbase collection, not a group of interface controls.",
        })}
      </h2>
      <div className="settings-content">
        <div className="setting-row">
          <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>{info?.name ?? t`mdbase collection`}</span>
          <small>
            {loading ? (
              t`Opening`
            ) : (
              <Trans>
                {open} open · {total} total
              </Trans>
            )}
          </small>
        </div>
        <button
          className="text-action"
          disabled={refreshing}
          type="button"
          onClick={() => void refresh()}
        >
          {refreshing ? t`Refreshing` : t`Refresh now`}
        </button>
        <button
          aria-expanded={showLocation}
          className="setting-explanation"
          type="button"
          onClick={() => setShowLocation((value) => !value)}
        >
          <span>{t`How tasks are stored`}</span>
          {showLocation ? (
            <ChevronUp aria-hidden="true" size={17} />
          ) : (
            <ChevronDown aria-hidden="true" size={17} />
          )}
        </button>
        {showLocation ? (
          <div className="collection-storage-detail">
            <p className="section-copy">
              <Trans>
                mdbase is the source of truth. Changes require a connection.
              </Trans>
            </p>
            {info ? (
              <code className="collection-path">{info.location}</code>
            ) : null}
            {lastRefresh ? (
              <p className="refresh-detail">
                <Trans>
                  Last refresh checked{" "}
                  <Plural value={scanned} one="# record" other="# records" /> in{" "}
                  {elapsed} ms.
                </Trans>
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="settings-subsection">
          <h3>
            {t({ message: "Connection", context: "mdbase authority status" })}
          </h3>
          <div className="setting-row">
            <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
            <span>mdbase</span>
            <small>{connectionLabel}</small>
          </div>
          {connection.message ? (
            <p className="section-copy" role="status">
              {connection.message}
            </p>
          ) : null}
          <div className="cloud-actions">
            <button
              className="text-action"
              type="button"
              onClick={changeCollection}
            >{t`Change collection`}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
