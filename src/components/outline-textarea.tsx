import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { useLingui } from "@lingui/react/macro";
import { Code2 } from "lucide-react";
import {
  editOutlineDisplay,
  outlineReferences,
} from "../domain/outline-references";
import { outlineSelection, setOutlineSelection } from "./outline-selection";
import "./outline-references.css";

import { linkDisplayLabel } from "../domain/completion";

const WIKILINK = /\[\[[^\]\n]+\]\]/g;

/** Wrap visually without introducing newlines into an outline node. */
export function OutlineTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    onValueChange?(
      text: string,
      start: number,
      end: number,
      direction: "forward" | "backward" | "none",
    ): void;
  },
) {
  const { t } = useLingui();
  const { onValueChange, ...textareaProps } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);
  const [raw, setRaw] = useState(false);
  const source = typeof props.value === "string" ? props.value : "";
  const display = outlineReferences(source).display;
  const rich = !raw && display !== source;
  useLayoutEffect(() => {
    if (pendingCursor.current === null || !ref.current) return;
    setOutlineSelection(ref.current, pendingCursor.current);
    pendingCursor.current = null;
  }, [source, raw]);
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
  }, [props.value, raw]);
  const rendered =
    typeof props.value === "string" ? renderedLinks(props.value) : null;
  return (
    <span className={`outline-text-shell${rich ? " is-rich-reference" : ""}`}>
      <textarea
        {...textareaProps}
        data-outline-source={rich ? source : undefined}
        value={rich ? display : props.value}
        className={
          rendered && !raw
            ? `${props.className ?? ""} has-rendered-links`.trim()
            : props.className
        }
        rows={1}
        ref={ref}
        onChange={(event) => {
          if (!onValueChange) {
            props.onChange?.(event);
            return;
          }
          const input = event.currentTarget;
          const edit = rich
            ? editOutlineDisplay(source, input.value)
            : { text: input.value, cursor: input.selectionStart };
          if (rich) pendingCursor.current = edit.cursor;
          onValueChange(
            edit.text,
            edit.cursor,
            rich ? edit.cursor : input.selectionEnd,
            input.selectionDirection,
          );
        }}
      />
      {rendered && !raw ? (
        <span aria-hidden="true" className="outline-rendered-text">
          {rendered}
        </span>
      ) : null}
      {rendered ? (
        <button
          className="outline-source-toggle"
          aria-label={t`Edit reference Markdown`}
          aria-pressed={raw}
          type="button"
          onClick={() => {
            if (ref.current)
              pendingCursor.current = outlineSelection(ref.current);
            setRaw(!raw);
            requestAnimationFrame(() =>
              ref.current?.focus({ preventScroll: true }),
            );
          }}
        >
          <Code2 aria-hidden="true" size={15} />
        </button>
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
