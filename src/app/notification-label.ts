import type { MdbaseNotificationStatus } from "../native/mdbase-notifications";

export function changeNotificationLabel(
  status: MdbaseNotificationStatus,
): string {
  switch (status.state) {
    case "checking":
      return "Checking";
    case "enabled":
      return "On";
    case "off":
      return "Off";
    case "denied":
      return "Disabled in system settings";
    case "not_connected":
      return "Connect mdbase first";
    case "not_configured":
      return "Firebase setup required";
    case "reauthorization_required":
      return "Approval required";
    case "unavailable":
      return "Not available in this browser";
    case "error":
      return "Setup needs attention";
  }
}
