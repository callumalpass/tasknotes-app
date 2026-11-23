import { Trans } from "@lingui/react/macro";
import { Capacitor } from "@capacitor/core";

/** The advanced link to the separate self-hosted site, while signed out on the web. */
export function SelfHostedEntry() {
  if (
    !__SELF_HOSTED_UI_ORIGIN__ ||
    __SELF_HOSTED_UI_ORIGIN__ === location.origin ||
    Capacitor.isNativePlatform()
  )
    return null;
  return (
    <div className="advanced-server-link">
      <small>
        <Trans>Advanced</Trans>
      </small>{" "}
      <a href={__SELF_HOSTED_UI_ORIGIN__} rel="noreferrer">
        <Trans>Connect to your own server</Trans>
      </a>
    </div>
  );
}
