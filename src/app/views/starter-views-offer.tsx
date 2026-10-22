import { useAddStarterViews } from "../use-starter-views";

export function StarterViewsOffer({ onAdded }: { onAdded(): Promise<void> }) {
  const { add, adding, error } = useAddStarterViews(onAdded);
  return (
    <section
      aria-labelledby="starter-views-title"
      className="starter-views-offer"
    >
      <div>
        <h3 id="starter-views-title">Starter views</h3>
        <p>Adds Today, Upcoming, Calendar, Projects, and Archive.</p>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <button
        className="text-action"
        type="button"
        disabled={adding}
        onClick={() => void add()}
      >
        {adding ? "Adding starter views…" : "Add starter views"}
      </button>
    </section>
  );
}
