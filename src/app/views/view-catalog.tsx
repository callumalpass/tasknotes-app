import {
  Check,
  ChevronRight,
  FilePenLine,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  Search as SearchIcon,
  Trash2,
  Copy,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TaskView, TaskViewDocument } from "../../domain/view";
import { selectionFeedback } from "../../native/feedback";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "../navigation-views";
import { NavigationViewOrder, ViewIcon } from "./navigation-view-order";

type CatalogFilter = "all" | "navigation" | "editable";

type ToolEntry = {
  key: string;
  name: string;
  description: string;
  icon: typeof FilePenLine;
  open(): void;
};

export function ViewCatalog({
  documents,
  views,
  navigationViewKeys,
  onOpenScratchpad,
  onOpenSearch,
  onOpenView,
  onToggleNavigation,
  onMoveNavigation,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  documents: TaskViewDocument[];
  views: TaskView[];
  navigationViewKeys: string[];
  onOpenScratchpad(): void;
  onOpenSearch(): void;
  onOpenView(view: TaskView): void;
  onToggleNavigation(key: string): void;
  onMoveNavigation(key: string, direction: -1 | 1): void;
  onEdit(view: TaskView): void;
  onDuplicate(view: TaskView): void;
  onDelete(view: TaskView): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const tools = useMemo<ToolEntry[]>(
    () => [
      {
        key: SEARCH_NAVIGATION_KEY,
        name: "Search",
        description: "Find tasks across your collection",
        icon: SearchIcon,
        open: onOpenSearch,
      },
      {
        key: SCRATCHPAD_NAVIGATION_KEY,
        name: "Scratchpad",
        description: "Shape an outline before creating tasks",
        icon: FilePenLine,
        open: onOpenScratchpad,
      },
    ],
    [onOpenScratchpad, onOpenSearch],
  );
  const queryTools = tools.filter((tool) =>
    matchesQuery(
      normalizedQuery,
      tool.name,
      tool.description,
      "TaskNotes tool",
    ),
  );
  const queryViews = views.filter((view) =>
    matchesQuery(
      normalizedQuery,
      view.name,
      view.documentName,
      view.source.path,
    ),
  );
  const counts = {
    all: queryTools.length + queryViews.length,
    navigation:
      queryTools.filter((tool) => navigationViewKeys.includes(tool.key))
        .length +
      queryViews.filter((view) => navigationViewKeys.includes(view.key)).length,
    editable: queryViews.filter((view) => view.source.writable).length,
  };
  const visibleTools = queryTools.filter((tool) =>
    filter === "all"
      ? true
      : filter === "navigation"
        ? navigationViewKeys.includes(tool.key)
        : false,
  );
  const visibleViewKeys = new Set(
    queryViews
      .filter((view) =>
        filter === "all"
          ? true
          : filter === "navigation"
            ? navigationViewKeys.includes(view.key)
            : view.source.writable,
      )
      .map((view) => view.key),
  );
  const visibleDocuments = documents
    .map((document) => ({
      ...document,
      views: document.views.filter((view) => visibleViewKeys.has(view.key)),
    }))
    .filter((document) => document.views.length > 0);
  const visibleCount = visibleTools.length + visibleViewKeys.size;

  return (
    <div className="view-catalog">
      <NavigationViewOrder
        keys={navigationViewKeys}
        specialViews={[
          {
            key: SCRATCHPAD_NAVIGATION_KEY,
            name: "Scratchpad",
            icon: FilePenLine,
          },
          { key: SEARCH_NAVIGATION_KEY, name: "Search", icon: SearchIcon },
        ]}
        views={views}
        onMove={onMoveNavigation}
      />

      <section className="all-views" aria-labelledby="all-views-title">
        <header className="all-views-heading">
          <div>
            <h2 id="all-views-title">All views</h2>
            <p>Open a view or choose whether it appears in navigation.</p>
          </div>
          <span aria-label={`${visibleCount} views shown`}>
            {visibleCount} {visibleCount === 1 ? "view" : "views"}
          </span>
        </header>

        <div className="view-catalog-controls">
          <label className="view-search-field">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Search views"
              type="search"
              value={query}
              placeholder="Search views"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="view-filter-list" aria-label="Filter views">
            {(
              [
                ["all", "All"],
                ["navigation", "In navigation"],
                ["editable", "Editable"],
              ] as const
            ).map(([key, label]) => (
              <button
                aria-pressed={filter === key}
                key={key}
                type="button"
                onClick={() => setFilter(key)}
              >
                {label} <span>{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {visibleCount === 0 ? (
          <div className="view-catalog-empty">
            <h3>No matching views</h3>
            <p>Try another search or filter.</p>
          </div>
        ) : (
          <div className="view-document-list">
            {visibleTools.length ? (
              <section
                aria-labelledby="view-document-tasknotes"
                className="view-document"
              >
                <header className="view-document-heading">
                  <div>
                    <h3 id="view-document-tasknotes">TaskNotes tools</h3>
                    <p>Built-in working spaces</p>
                  </div>
                </header>
                <div className="saved-view-list">
                  {visibleTools.map((tool) => (
                    <ToolRow
                      inNavigation={navigationViewKeys.includes(tool.key)}
                      isOnlyNavigationEntry={
                        navigationViewKeys.length === 1 &&
                        navigationViewKeys[0] === tool.key
                      }
                      key={tool.key}
                      tool={tool}
                      onToggleNavigation={onToggleNavigation}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {visibleDocuments.length ? (
              <section
                className="saved-views-section"
                aria-labelledby="saved-views-title"
              >
                <header className="view-document-heading saved-views-heading">
                  <div>
                    <h3 id="saved-views-title">Saved views</h3>
                    <p>Views stored in your collection</p>
                  </div>
                </header>
                {visibleDocuments.map((document) => (
                  <section
                    aria-label={document.name}
                    className="view-document saved-view-document"
                    key={document.source.path}
                  >
                    {document.views.length > 1 ? (
                      <header className="saved-view-source-heading">
                        <h4>{document.name}</h4>
                        <small>{document.source.path}</small>
                      </header>
                    ) : null}
                    <div className="saved-view-list">
                      {document.views.map((view) => {
                        const inNavigation = navigationViewKeys.includes(
                          view.key,
                        );
                        const isOnlyNavigationEntry =
                          inNavigation && navigationViewKeys.length === 1;
                        return (
                          <SavedViewRow
                            inNavigation={inNavigation}
                            isOnlyNavigationEntry={isOnlyNavigationEntry}
                            key={view.key}
                            view={view}
                            onDelete={onDelete}
                            onDuplicate={onDuplicate}
                            onEdit={onEdit}
                            onOpen={onOpenView}
                            onToggleNavigation={onToggleNavigation}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function ToolRow({
  tool,
  inNavigation,
  isOnlyNavigationEntry,
  onToggleNavigation,
}: {
  tool: ToolEntry;
  inNavigation: boolean;
  isOnlyNavigationEntry: boolean;
  onToggleNavigation(key: string): void;
}) {
  const Icon = tool.icon;
  return (
    <div className="saved-view-row is-tool-row">
      <button className="saved-view-open" type="button" onClick={tool.open}>
        <Icon aria-hidden="true" size={21} strokeWidth={1.55} />
        <span>
          <strong>{tool.name}</strong>
          <small>{tool.description}</small>
        </span>
        <ChevronRight aria-hidden="true" size={18} />
      </button>
      <NavigationMembershipButton
        disabled={isOnlyNavigationEntry}
        inNavigation={inNavigation}
        name={tool.name}
        onClick={() => onToggleNavigation(tool.key)}
      />
    </div>
  );
}

function SavedViewRow({
  view,
  inNavigation,
  isOnlyNavigationEntry,
  onOpen,
  onToggleNavigation,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  view: TaskView;
  inNavigation: boolean;
  isOnlyNavigationEntry: boolean;
  onOpen(view: TaskView): void;
  onToggleNavigation(key: string): void;
  onEdit(view: TaskView): void;
  onDuplicate(view: TaskView): void;
  onDelete(view: TaskView): void;
}) {
  return (
    <div className="saved-view-row">
      <button
        className="saved-view-open"
        type="button"
        onClick={() => onOpen(view)}
      >
        <ViewIcon view={view} />
        <span>
          <strong>{view.name}</strong>
          <small className="saved-view-path">{view.source.path}</small>
        </span>
        <ChevronRight aria-hidden="true" size={18} />
      </button>
      <ViewActions
        view={view}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onEdit={onEdit}
      />
      <NavigationMembershipButton
        disabled={isOnlyNavigationEntry}
        inNavigation={inNavigation}
        name={view.name}
        onClick={() => onToggleNavigation(view.key)}
      />
    </div>
  );
}

function NavigationMembershipButton({
  name,
  inNavigation,
  disabled = false,
  onClick,
}: {
  name: string;
  inNavigation: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  const action = inNavigation ? "Remove" : "Add";
  const label = disabled
    ? `${name} must remain in navigation until another view is added`
    : `${action} ${name} ${inNavigation ? "from" : "to"} navigation`;
  return (
    <button
      aria-label={label}
      aria-pressed={inNavigation}
      className="saved-view-membership"
      disabled={disabled}
      type="button"
      onClick={() => {
        selectionFeedback();
        onClick();
      }}
    >
      {inNavigation ? (
        <Check aria-hidden="true" size={16} />
      ) : (
        <Pin aria-hidden="true" size={16} />
      )}
      <span className="membership-label-full">
        {inNavigation ? "In navigation" : "Add"}
      </span>
      <span className="membership-label-short">
        {inNavigation ? "Added" : "Add"}
      </span>
    </button>
  );
}

function ViewActions({
  view,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  view: TaskView;
  onEdit(view: TaskView): void;
  onDuplicate(view: TaskView): void;
  onDelete(view: TaskView): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  function navigateMenu(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="saved-view-actions" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`More actions for ${view.name}`}
        className="saved-view-more"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" size={19} />
      </button>
      {open ? (
        <div
          aria-label={`Actions for ${view.name}`}
          className="saved-view-menu"
          role="menu"
          onKeyDown={navigateMenu}
        >
          {view.source.writable ? (
            <button
              ref={firstActionRef}
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => choose(() => onEdit(view))}
            >
              <Pencil aria-hidden="true" size={16} /> Edit
            </button>
          ) : null}
          <button
            ref={view.source.writable ? undefined : firstActionRef}
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={() => choose(() => onDuplicate(view))}
          >
            <Copy aria-hidden="true" size={16} /> Duplicate
          </button>
          {view.source.writable ? (
            <button
              className="is-danger"
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => choose(() => onDelete(view))}
            >
              <Trash2 aria-hidden="true" size={16} /> Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function matchesQuery(query: string, ...values: string[]): boolean {
  return (
    !query || values.some((value) => value.toLocaleLowerCase().includes(query))
  );
}
