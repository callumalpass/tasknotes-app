import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";

import { linkTarget } from "../domain/completion";

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
  valueLabel = displayValue,
  onChange,
}: {
  label: string;
  field: string;
  placeholder: string;
  values: string[];
  completion: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
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

  function add(value: string) {
    const next = value.trim();
    if (!next) return;
    if (!values.some((candidate) => candidate === next))
      onChange([...values, next]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function addQuery() {
    const option = options[activeIndex];
    if (option) add(option.value);
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
      onChange(values.slice(0, -1));
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
            <span>{valueLabel(value)}</span>
            <button
              aria-label={`Remove ${valueLabel(value)}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(values.filter((candidate) => candidate !== value));
              }}
            >
              <X aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
          </span>
        ))}
        <input
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
        <div className="field-suggestions" id={`${id}-options`} role="listbox">
          {loading ? (
            <span className="field-suggestion-status">
              Looking in collection…
            </span>
          ) : (
            options.map((option, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : undefined}
                key={`${option.kind}:${option.value}`}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => add(option.value)}
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
    </div>
  );
}

function displayValue(value: string): string {
  const target = linkTarget(value);
  return target.split("/").at(-1) || value;
}
