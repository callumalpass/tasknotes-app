// Local development fixture only; no real account, credentials, or key custody.
import { createRoot } from "react-dom/client";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { AppI18nProvider } from "../src/i18n/app-provider";
import { recurrenceRuleSummary } from "../src/i18n/presentation";
import { parseRecurrenceRule } from "../src/domain/recurrence-rule";
import {
  passwordStrength,
  type PrivateAccountStatus,
} from "@mdbase-dev/sdk/account";
import {
  PrivateAccountSettings,
  type PrivateAccountUi,
} from "../src/components/private-account-settings";
import "../src/styles.css";
import "../src/accessibility.css";
if (import.meta.env.MODE !== "e2e")
  throw new Error("private-account fixture requires e2e mode");
const parameters = new URLSearchParams(location.search);
const count = Math.min(101, Math.max(0, Number(parameters.get("count")) || 0));
const incomplete = Array.from({ length: count }, (_, index) => String(index));
const pending = incomplete.map((collectionId) => ({
  collectionId,
  deviceId: "fixture-device",
  revokedAt: null,
}));
let state: PrivateAccountStatus = { mode: "none", unlocked: false, version: 0 };
const account: PrivateAccountUi = {
  status: async () => state,
  passwordStrength,
  setup: async () => {
    state = { mode: "password", unlocked: true, version: 1 };
    return { recoveryKey: "MDB1-PUBLIC-TEST-FIXTURE-ONLY", incomplete };
  },
  unlock: async () => {
    state = { ...state, unlocked: true };
    return { incomplete };
  },
  recover: async () => {
    state = { ...state, unlocked: true };
    return {};
  },
  changePassword: async () => {},
  enableStrict: async () => {
    state = {
      mode: "strict",
      version: 2,
      unlocked: false,
      strictComplete: false,
      pending,
      accountKeyKept: true,
    };
    return {
      version: 2,
      complete: false,
      pending,
      accountKeyKept: true,
      alreadyStrict: false,
      revocations: [],
    };
  },
  lock: async () => {
    state = { ...state, unlocked: false };
  },
};
function Fixture() {
  useLingui();
  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <h1>
          <Trans>Settings</Trans>
        </h1>
      </header>
      {parameters.has("summaries") ? (
        <div>
          <p data-testid="daily-summary">
            {recurrenceRuleSummary(
              parseRecurrenceRule(`FREQ=DAILY;INTERVAL=${Math.max(1, count)}`),
            )}
          </p>
          {[-1, -2, -3, -5, -11, -21, -22, -31].map((day) => (
            <p data-testid={`month-end-${-day}`} key={day}>
              {recurrenceRuleSummary(
                parseRecurrenceRule(`FREQ=MONTHLY;BYMONTHDAY=${day}`),
              )}
            </p>
          ))}
        </div>
      ) : null}
      <section className="settings-section settings-section-account">
        <header className="settings-section-header">
          <h2>
            <Trans>Private collection recovery</Trans>
          </h2>
        </header>
        <PrivateAccountSettings account={account} />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <AppI18nProvider>
    <Fixture />
  </AppI18nProvider>,
);
