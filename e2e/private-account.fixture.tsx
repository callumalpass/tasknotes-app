// Local development fixture only; no real account, credentials, or key custody.
import { createRoot } from "react-dom/client";
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
let state: PrivateAccountStatus = { mode: "none", unlocked: false, version: 0 };
const account: PrivateAccountUi = {
  status: async () => state,
  passwordStrength,
  setup: async () => {
    state = { mode: "password", unlocked: true, version: 1 };
    return { recoveryKey: "MDB1-PUBLIC-TEST-FIXTURE-ONLY" };
  },
  unlock: async () => {
    state = { ...state, unlocked: true };
    return {};
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
      pending: [],
      accountKeyKept: true,
    };
    return {
      version: 2,
      complete: false,
      pending: [],
      accountKeyKept: true,
      alreadyStrict: false,
      revocations: [],
    };
  },
  lock: async () => {
    state = { ...state, unlocked: false };
  },
};
createRoot(document.getElementById("root")!).render(
  <div className="screen settings-screen">
    <PrivateAccountSettings account={account} />
  </div>,
);
