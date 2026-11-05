import { useLingui, Trans } from "@lingui/react/macro";
import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TaskNotesOption } from "./tasknotes-controls";
import "./choice-options.css";

export function ChoiceOptions({
  options,
  value,
  label,
  disabled = false,
  role = "option",
  labelledBy,
  onChoose,
}: {
  options: readonly TaskNotesOption[];
  value: string;
  label?: string;
  disabled?: boolean;
  role?: "option" | "menuitemradio";
  labelledBy?: string;
  onChoose(value: string): void;
}) {
  const { t } = useLingui();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const defaultLabel = t`options`;
  const filterLabel = label ?? defaultLabel;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    root.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    root.current
      ?.querySelector(".is-active")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, query]);
  return (
    <div className="choice-options" ref={root}>
      <input
        aria-label={t`Filter ${filterLabel}`}
        aria-controls={`${id}-list`}
        aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        placeholder={t`Filter…`}
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          const enabled = filtered.flatMap((option, index) =>
            option.disabled ? [] : [index],
          );
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            const option = filtered[active];
            if (option && !option.disabled && !disabled) onChoose(option.value);
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            const current = enabled.indexOf(active);
            const next =
              event.key === "Home"
                ? enabled[0]
                : event.key === "End"
                  ? enabled.at(-1)
                  : enabled[
                      (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        enabled.length) %
                        enabled.length
                    ];
            if (next !== undefined) setActive(next);
          }
        }}
      />
      <div
        className="tasknotes-option-list"
        id={`${id}-list`}
        role={role === "option" ? "listbox" : "menu"}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
      >
        {filtered.map((option, index) => (
          <button
            aria-selected={
              role === "option" ? option.value === value : undefined
            }
            aria-checked={
              role === "menuitemradio" ? option.value === value : undefined
            }
            className={active === index ? "is-active" : undefined}
            disabled={disabled || option.disabled}
            id={`${id}-${index}`}
            key={option.value}
            role={role}
            type="button"
            onMouseEnter={() => setActive(index)}
            onClick={() => onChoose(option.value)}
          >
            {option.color ? (
              <i
                aria-hidden="true"
                className="value-color"
                style={{ backgroundColor: option.color }}
              />
            ) : null}
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            {option.value === value ? (
              <Check aria-hidden="true" size={16} />
            ) : null}
          </button>
        ))}
        {!filtered.length ? (
          <p role="status">
            <Trans>No matches</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
