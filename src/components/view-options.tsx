import { Ellipsis } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure containing ordinary buttons, not a partially implemented ARIA menu. */
export function ViewOptions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details
      className="view-options"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          ref.current?.removeAttribute("open");
          ref.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="View options" title="View options">
        <Ellipsis aria-hidden="true" size={20} />
      </summary>
      <div
        className="view-options-panel"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) {
            ref.current?.removeAttribute("open");
            ref.current?.querySelector("summary")?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
