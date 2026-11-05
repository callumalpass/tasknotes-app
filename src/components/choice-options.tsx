import { useLingui, Trans } from "@lingui/react/macro";
import { Check, X } from "lucide-react";
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
  onClose,
}: {
  options: readonly TaskNotesOption[];
  value: string;
  label?: string;
  disabled?: boolean;
  role?: "option" | "menuitemradio";
  labelledBy?: string;
  onChoose(value: string): void;
  onClose?(): void;
}) {
  const { t } = useLingui();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const defaultLabel = t`options`;
  const filterLabel = label ?? defaultLabel;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => {
    const selected = options.findIndex(
      (option) => option.value === value && !option.disabled,
    );
    return selected >= 0
      ? selected
      : options.findIndex((option) => !option.disabled);
  });
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
      {onClose ? (
        <header className="choice-options-header">
          <strong>{label ?? defaultLabel}</strong>
          <button
            aria-label={t`Close`}
            className="icon-action"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
      ) : null}
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
          setActive(
            options
              .filter((option) =>
                option.label
                  .toLocaleLowerCase()
                  .includes(event.target.value.trim().toLocaleLowerCase()),
              )
              .findIndex((option) => !option.disabled),
          );
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
            <i
              aria-hidden="true"
              className="value-color"
              style={{ backgroundColor: option.color ?? "transparent" }}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            <Check
              aria-hidden="true"
              className={
                option.value === value ? undefined : "choice-check-empty"
              }
              size={16}
            />
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
