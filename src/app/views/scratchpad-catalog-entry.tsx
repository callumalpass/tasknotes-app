import {
  ChevronRight,
  FilePenLine,
  Pin,
  Search as SearchIcon,
} from "lucide-react";

import { selectionFeedback } from "../../native/feedback";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "../navigation-views";

export function TaskNotesCatalogEntries({
  navigationKeys,
  onOpenScratchpad,
  onOpenSearch,
  onToggleNavigation,
}: {
  navigationKeys: string[];
  onOpenScratchpad(): void;
  onOpenSearch(): void;
  onToggleNavigation(key: string): void;
}) {
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
        <TaskNotesCatalogRow
          description="Find tasks across your collection"
          icon={SearchIcon}
          inNavigation={navigationKeys.includes(SEARCH_NAVIGATION_KEY)}
          name="Search"
          navigationKey={SEARCH_NAVIGATION_KEY}
          onOpen={onOpenSearch}
          onToggleNavigation={onToggleNavigation}
        />
        <TaskNotesCatalogRow
          description="Shape an outline before creating tasks"
          icon={FilePenLine}
          inNavigation={navigationKeys.includes(SCRATCHPAD_NAVIGATION_KEY)}
          name="Scratchpad"
          navigationKey={SCRATCHPAD_NAVIGATION_KEY}
          onOpen={onOpenScratchpad}
          onToggleNavigation={onToggleNavigation}
        />
      </div>
    </section>
  );
}

function TaskNotesCatalogRow({
  description,
  icon: Icon,
  inNavigation,
  name,
  navigationKey,
  onOpen,
  onToggleNavigation,
}: {
  description: string;
  icon: typeof FilePenLine;
  inNavigation: boolean;
  name: string;
  navigationKey: string;
  onOpen(): void;
  onToggleNavigation(key: string): void;
}) {
  return (
    <div className="saved-view-row">
      <button className="saved-view-open" type="button" onClick={onOpen}>
        <Icon aria-hidden="true" size={21} strokeWidth={1.55} />
        <span>
          <strong>{name}</strong>
          <small>{description}</small>
        </span>
        <ChevronRight aria-hidden="true" size={18} />
      </button>
      <button
        aria-label={`${inNavigation ? "Remove" : "Add"} ${name} ${
          inNavigation ? "from" : "to"
        } navigation`}
        aria-pressed={inNavigation}
        className="saved-view-pin"
        type="button"
        onClick={() => {
          selectionFeedback();
          onToggleNavigation(navigationKey);
        }}
      >
        <Pin
          aria-hidden="true"
          fill={inNavigation ? "currentColor" : "none"}
          size={17}
        />
      </button>
    </div>
  );
}
