/** Same initial geometry and original collection action as the eager shell. */
export function AppShellLoading({
  markUrl,
  changeCollection,
}: {
  markUrl: string;
  changeCollection(): void;
}) {
  return (
    <main className="opening-screen">
      <img alt="" src={markUrl} />
      <p>Opening your tasks</p>
      <LoadingRows count={4} />
      <button
        className="text-action opening-change-collection"
        type="button"
        onClick={changeCollection}
      >
        Choose another mdbase collection
      </button>
    </main>
  );
}

/** Keep the existing screen/header footprint while optional UI loads. */
export function ScreenLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading view"
      className="screen view-detail"
    >
      <header className="view-header operational">
        <div>
          <h1>Opening your view</h1>
          <small>Loading…</small>
        </div>
      </header>
      <LoadingRows count={6} />
    </section>
  );
}

export function LoadingRows({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading tasks" className="loading-rows" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-row" key={index}>
          <span className="loading-circle" />
          <span className="loading-line" />
        </div>
      ))}
    </div>
  );
}
