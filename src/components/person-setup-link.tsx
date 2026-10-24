import { Trans } from "@lingui/react/macro";
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
        <span>
          <Trans>Choose or create your person record</Trans>
        </span>{" "}
        <span className="people-action-caption">
          <Trans>Opens in a new tab</Trans>
        </span>
      </span>
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  );
}
