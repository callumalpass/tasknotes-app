import { t } from "@lingui/core/macro";
import type { MdbaseNotificationStatus } from "../native/mdbase-notifications";

export function changeNotificationLabel(
  status: MdbaseNotificationStatus,
): string {
  switch (status.state) {
    case "checking":
      return t({ message: "Checking" });
    case "enabled":
      return t({ message: "On", context: "notifications enabled state" });
    case "off":
      return t({ message: "Off" });
    case "denied":
      return t({ message: "Disabled in system settings" });
    case "not_connected":
      return t({ message: "Open a collection first" });
    case "not_configured":
      return t({ message: "Firebase setup required" });
    case "reauthorization_required":
      return t({ message: "Approval required" });
    case "unavailable":
      return t({ message: "Not available in this browser" });
    case "error":
      return t({ message: "Setup needs attention" });
  }
}
