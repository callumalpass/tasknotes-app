import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import { useAddStarterViews } from "../use-starter-views";

export function StarterViewsOffer({ onAdded }: { onAdded(): Promise<void> }) {
  const { add, adding, error } = useAddStarterViews(onAdded);
  return (
    <section
      aria-labelledby="starter-views-title"
      className="starter-views-offer"
    >
      <div>
        <h3 id="starter-views-title">
          <Trans>Starter views</Trans>
        </h3>
        <p>
          <Trans>
            Adds missing Today, Upcoming, Calendar, Projects, Archive, and
            Inbox views. Existing files and navigation choices stay
            unchanged.
          </Trans>
        </p>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <button
        className="text-action"
        type="button"
        disabled={adding}
        onClick={() => void add()}
      >
        {adding
          ? translate({ message: "Adding starter views…" })
          : translate({ message: "Add starter views" })}
      </button>
    </section>
  );
}
