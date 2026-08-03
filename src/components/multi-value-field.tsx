import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";

import { linkLabel, linkTarget } from "../domain/completion";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskFieldCompletionConfiguration } from "../domain/task-configuration";

export function MultiValueField({
  label,
  field,
  placeholder,
  values,
  completion,
  completeField,
  valueLabels,
  valueLabel = displayValue,
  onChange,
}: {
  label: string;
  field: string;
  placeholder: string;
  values: string[];
  completion: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  valueLabels?: ReadonlyMap<string, string>;
  valueLabel?(value: string): string;
  onChange(values: string[]): void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FieldCompletion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<Record<string, string>>(
    {},
  );

  const labelFor = (value: string) =>
    selectedLabels[value] ?? valueLabels?.get(value) ?? valueLabel(value);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timeout = window.setTimeout(
      () => {
        setLoading(true);
        void completeField({
          field,
          kind: completion.kind,
          query,
          limit: 12,
          targetTypes: completion.targetTypes,
          configuredValues: completion.values,
        })
          .then((next) => {
            if (!active) return;
            const selected = new Set(
              values.map((value) => value.toLocaleLowerCase()),
            );
            setOptions(
              next.filter(
                (option) => !selected.has(option.value.toLocaleLowerCase()),
              ),
            );
            setActiveIndex(0);
          })
          .catch(() => {
            if (active) setOptions([]);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      completion.kind === "records" ? 160 : 40,
    );
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [completeField, completion, field, open, query, values]);

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  function add(value: string, label?: string) {
    const next = value.trim();
    if (!next) return;
    if (
      !values.some(
        (candidate) =>
          candidate.toLocaleLowerCase() === next.toLocaleLowerCase(),
      )
    ) {
      onChange([...values, next]);
      if (label)
        setSelectedLabels((current) => ({ ...current, [next]: label }));
      setAnnouncement(`${label ?? labelFor(next)} added`);
    }
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function addQuery() {
    const option = options[activeIndex];
    if (option) add(option.value, option.label);
    else add(query.replace(/,$/, ""));
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        Math.min(index + 1, Math.max(options.length - 1, 0)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      if (!query.trim() && !options.length) return;
      event.preventDefault();
      addQuery();
      return;
    }
    if (event.key === "Backspace" && !query && values.length) {
      const removed = values.at(-1);
      onChange(values.slice(0, -1));
      if (removed) setAnnouncement(`${labelFor(removed)} removed`);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      event.currentTarget.blur();
    }
  }

  const showOptions =
    open && (loading || options.length > 0 || Boolean(query.trim()));
  return (
    <div className="form-field multi-value-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div
        className="multi-value-control"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value) => (
          <span className="field-token" key={value}>
            <span>{labelFor(value)}</span>
            <button
              aria-label={`Remove ${labelFor(value)}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(values.filter((candidate) => candidate !== value));
                setAnnouncement(`${labelFor(value)} removed`);
              }}
            >
              <X aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
          </span>
        ))}
        <input
          aria-activedescendant={
            showOptions && !loading && options[activeIndex]
              ? `${id}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={showOptions}
          autoComplete="off"
          id={`${id}-input`}
          placeholder={values.length ? "" : placeholder}
          ref={inputRef}
          role="combobox"
          value={query}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => {
              if (query.trim()) add(query);
              setOpen(false);
            }, 120);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={keyDown}
        />
      </div>
      {showOptions ? (
        <div
          aria-label={`${label} suggestions`}
          className="field-suggestions"
          id={`${id}-options`}
          role="listbox"
        >
          {loading ? (
            <span className="field-suggestion-status">
              Looking in collection…
            </span>
          ) : (
            options.map((option, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : undefined}
                id={`${id}-option-${index}`}
                key={`${option.kind}:${option.value}`}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => add(option.value, option.label)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.detail && option.detail !== option.label ? (
                    <small>{option.detail}</small>
                  ) : null}
                </span>
                {values.includes(option.value) ? (
                  <Check aria-hidden="true" size={15} />
                ) : null}
              </button>
            ))
          )}
          {!loading && query.trim() ? (
            <button
              className="field-suggestion-create"
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(query)}
            >
              Use “{query.trim()}”
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function displayValue(value: string): string {
  const label = linkLabel(value);
  if (label) return label;
  const target = linkTarget(value);
  return target.split("/").at(-1) || value;
}
