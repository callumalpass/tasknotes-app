import { useLingui } from "@lingui/react/macro";
export function LoadingRows({ count = 6 }: { count?: number }) {
  const { t } = useLingui();
  return (
    <div
      aria-label={t({ message: "Loading tasks" })}
      className="loading-rows"
      role="status"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-row" key={index}>
          <span className="loading-circle" />
          <span className="loading-line" />
        </div>
      ))}
    </div>
  );
}
