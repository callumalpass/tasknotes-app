import { ChevronRight, FilePenLine, Pin } from "lucide-react";

import { selectionFeedback } from "../../native/feedback";
import { SCRATCHPAD_NAVIGATION_KEY } from "../navigation-views";

export function ScratchpadCatalogEntry({
  navigationKeys,
  onOpen,
  onToggleNavigation,
}: {
  navigationKeys: string[];
  onOpen(): void;
  onToggleNavigation(key: string): void;
}) {
  const inNavigation = navigationKeys.includes(SCRATCHPAD_NAVIGATION_KEY);
  return (
    <section
      aria-labelledby="view-document-tasknotes"
      className="view-document"
    >
      <header className="view-document-heading">
        <h2 id="view-document-tasknotes">TaskNotes</h2>
        <small>Working tools</small>
      </header>
      <div className="saved-view-list">
        <div className="saved-view-row">
          <button className="saved-view-open" type="button" onClick={onOpen}>
            <FilePenLine aria-hidden="true" size={21} strokeWidth={1.55} />
            <span>
              <strong>Scratchpad</strong>
              <small>Shape an outline before creating tasks</small>
            </span>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
          <button
            aria-label={
              inNavigation
                ? "Remove Scratchpad from navigation"
                : "Add Scratchpad to navigation"
            }
            aria-pressed={inNavigation}
            className="saved-view-pin"
            type="button"
            onClick={() => {
              selectionFeedback();
              onToggleNavigation(SCRATCHPAD_NAVIGATION_KEY);
            }}
          >
            <Pin
              aria-hidden="true"
              fill={inNavigation ? "currentColor" : "none"}
              size={17}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
