import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  paletteSectionLabels,
  rankCommands,
  type PaletteCommand,
} from "../app/command-palette-model";
import { useOverlay } from "./overlays/use-overlay";

/**
 * A keyboard-first command list: one combobox filters navigation, actions,
 * the focused task's actions, and matching tasks. Enter runs the active
 * option; Escape closes and returns focus to where the palette was opened.
 */
export function CommandPalette({
  open,
  commands,
  query,
  taskResults = [],
  searchingTasks = false,
  onQueryChange,
  onClose,
}: {
  open: boolean;
  commands: readonly PaletteCommand[];
  query: string;
  taskResults?: readonly PaletteCommand[];
  searchingTasks?: boolean;
  onQueryChange(query: string): void;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();
  const optionId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo(
    () => [...rankCommands(commands, query), ...taskResults],
    [commands, query, taskResults],
  );
  const active = Math.min(activeIndex, Math.max(options.length - 1, 0));
  const [previousQuery, setPreviousQuery] = useState(query);
  if (previousQuery !== query) {
    setPreviousQuery(query);
    setActiveIndex(0);
  }

  useOverlay({
    open,
    rootRef: dialogRef,
    modal: true,
    onDismiss: onClose,
    initialFocus: () => inputRef.current,
  });

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  function run(command: PaletteCommand | undefined) {
    if (!command) return;
    onClose();
    // Let the overlay restore focus before the command moves it elsewhere.
    window.setTimeout(() => command.run(), 0);
  }

  const groups: { section: PaletteCommand["section"]; start: number }[] = [];
  options.forEach((command, index) => {
    if (groups.at(-1)?.section !== command.section)
      groups.push({ section: command.section, start: index });
  });

  return createPortal(
    <div className="command-palette-scrim">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="command-palette"
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="visually-hidden" id={titleId}>
          Command palette
        </h2>
        <div className="command-palette-field">
          <Search aria-hidden="true" size={18} />
          <input
            aria-activedescendant={
              options.length ? `${optionId}-${active}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-label="Search commands and tasks"
            autoComplete="off"
            placeholder="Go to, run an action, or find a task…"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const last = options.length - 1;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex(active >= last ? 0 : active + 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex(active <= 0 ? last : active - 1);
              } else if (event.key === "Home" && event.ctrlKey) {
                event.preventDefault();
                setActiveIndex(0);
              } else if (event.key === "End" && event.ctrlKey) {
                event.preventDefault();
                setActiveIndex(last);
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(options[active]);
              }
            }}
          />
        </div>
        <div
          aria-label="Results"
          className="command-palette-results"
          id={listId}
          ref={listRef}
          role="listbox"
        >
          {groups.map((group, groupIndex) => {
            const end = groups[groupIndex + 1]?.start ?? options.length;
            const headingId = `${optionId}-group-${group.section}`;
            return (
              <div aria-labelledby={headingId} key={group.section} role="group">
                <p
                  className="command-palette-heading"
                  id={headingId}
                  role="presentation"
                >
                  {paletteSectionLabels[group.section]}
                </p>
                {options.slice(group.start, end).map((command, offset) => {
                  const index = group.start + offset;
                  return (
                    <div
                      aria-selected={index === active}
                      className="command-palette-option"
                      data-option-index={index}
                      id={`${optionId}-${index}`}
                      key={command.id}
                      role="option"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (index !== active) setActiveIndex(index);
                      }}
                      onClick={() => run(command)}
                    >
                      <span className="command-palette-label">
                        {command.label}
                      </span>
                      {command.detail ? (
                        <small className="command-palette-detail">
                          {command.detail}
                        </small>
                      ) : null}
                      {command.shortcut ? (
                        <kbd className="command-palette-key">
                          {command.shortcut}
                        </kbd>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!options.length ? (
            <p className="command-palette-empty" role="status">
              {searchingTasks ? "Searching tasks…" : "No matching commands."}
            </p>
          ) : searchingTasks ? (
            <p className="command-palette-empty" role="status">
              Searching tasks…
            </p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
