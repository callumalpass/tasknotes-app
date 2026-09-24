import { useLayoutEffect, useRef } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";

import { linkDisplayLabel } from "../domain/completion";

const WIKILINK = /\[\[[^\]\n]+\]\]/g;

/** Wrap visually without introducing newlines into an outline node. */
export function OutlineTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value]);
  const rendered =
    typeof props.value === "string" ? renderedLinks(props.value) : null;
  // While unfocused, show link labels over the exact source; focusing the
  // row reveals the stored wikilink text. The wrapper is constant so typing
  // a link never remounts the focused textarea.
  return (
    <span className="outline-text-shell">
      <textarea
        {...props}
        className={
          rendered
            ? `${props.className ?? ""} has-rendered-links`.trim()
            : props.className
        }
        rows={1}
        ref={ref}
      />
      {rendered ? (
        <span aria-hidden="true" className="outline-rendered-text">
          {rendered}
        </span>
      ) : null}
    </span>
  );
}

function renderedLinks(value: string): ReactNode[] | null {
  const matches = [...value.matchAll(WIKILINK)];
  if (!matches.length) return null;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > offset) parts.push(value.slice(offset, start));
    parts.push(
      <span className="outline-link" key={start}>
        {linkDisplayLabel(match[0])}
      </span>,
    );
    offset = start + match[0].length;
  }
  if (offset < value.length) parts.push(value.slice(offset));
  return parts;
}
