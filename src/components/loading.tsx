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
