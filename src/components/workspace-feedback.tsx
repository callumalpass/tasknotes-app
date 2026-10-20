import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FeedbackHost = createContext<HTMLElement | null>(null);

/** Save outcomes and transient notices share one measured layout, so neither
 * can cover the other when text wraps or a notice offers additional actions. */
export function WorkspaceFeedback({
  children,
  aboveMobileControls,
}: {
  children: ReactNode;
  aboveMobileControls: boolean;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <FeedbackHost.Provider value={host}>
      {children}
      {createPortal(
        <div
          ref={setHost}
          className={`workspace-feedback${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        />,
        document.body,
      )}
    </FeedbackHost.Provider>
  );
}

export function FeedbackNotice({ children }: { children: ReactNode }) {
  const host = useContext(FeedbackHost);
  return createPortal(children, host ?? document.body);
}
