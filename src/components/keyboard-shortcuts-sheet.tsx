import { X } from "lucide-react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";

import { keyboardShortcutGroups } from "../app/keyboard-shortcuts";
import { useOverlay } from "./overlays/use-overlay";

export function KeyboardShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useOverlay({
    open,
    rootRef: dialogRef,
    modal: true,
    onDismiss: onClose,
    initialFocus: () => closeRef.current,
  });
  if (!open) return null;
  return createPortal(
    <div className="command-palette-scrim">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="keyboard-shortcuts-sheet"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <button
            aria-label="Close keyboard shortcuts"
            className="icon-action"
            ref={closeRef}
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        {keyboardShortcutGroups().map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.description}>
                  <dt>{shortcut.description}</dt>
                  <dd>
                    {shortcut.keys.map((key, index) => (
                      <span key={key}>
                        {index ? (
                          <span className="shortcut-or"> or </span>
                        ) : null}
                        <kbd>{key}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="keyboard-shortcuts-note">
          Task keys act on the focused row. Date keys keep any scheduled time.
        </p>
      </section>
    </div>,
    document.body,
  );
}
