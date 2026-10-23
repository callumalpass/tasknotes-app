import { LanguagePicker } from "@mdbase-dev/i18n/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

export function LanguageSettings() {
  const { t, i18n } = useLingui();
  const [failedLocale, setFailedLocale] = useState<string | null>(null);
  return (
    <div className="settings-group">
      <h3>
        <Trans>Language</Trans>
      </h3>
      <div className="setting-row language-setting-row">
        <span>
          <Trans>App language</Trans>
        </span>
        <LanguagePicker
          className="language-picker"
          label={t`App language`}
          onError={() => setFailedLocale(i18n.locale)}
        />
      </div>
      {failedLocale === i18n.locale ? (
        <p className="inline-error" role="alert">
          <Trans>
            The language could not be loaded. Check your connection and try
            again.
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
