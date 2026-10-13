import { ArrowUpRight, UserRound } from "lucide-react";
import { personSettingsUrl } from "../cloud/person-settings-url";

export function PersonSetupLink({
  href,
  onOpen,
}: {
  href: string;
  onOpen(): void;
}) {
  return (
    <a
      className="people-action people-profile-link"
      href={personSettingsUrl(
        href,
        import.meta.env.VITE_TASKNOTES_EDITOR_ORIGIN,
      )}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
    >
      <UserRound size={18} aria-hidden="true" />
      <span className="people-profile-label">
        <span>Choose or create your person record</span>{" "}
        <span className="people-action-caption">Opens in a new tab</span>
      </span>
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  );
}
