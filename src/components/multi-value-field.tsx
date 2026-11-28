import { useLingui, Trans } from "@lingui/react/macro";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, X } from "lucide-react";

import { linkDisplayLabel } from "../domain/completion";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskFieldCompletionConfiguration } from "../domain/task-configuration";

const noOptions: readonly FieldCompletion[] = [];

export function MultiValueField({
  label,
  field,
  placeholder,
  values,
  completion,
  completeField,
  valueLabels,
  valueLabel = linkDisplayLabel,
  usedFirst = false,
  autoFocus = false,
  onChange,
  onPick,
  onEscape,
}: {
  label: string;
  field: string;
  placeholder: string;
  values: string[];
  completion: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  valueLabels?: ReadonlyMap<string, string>;
  valueLabel?(value: string): string;
  /** Before anything is typed, list only values the collection already uses. */
  usedFirst?: boolean;
  autoFocus?: boolean;
  onChange?(values: string[]): void;
  /** Makes this a single choice: a pick commits at once instead of adding a chip. */
  onPick?(value: string, label: string): void;
  /** Escape leaves the surrounding picker instead of only closing suggestions. */
  onEscape?(): void;
}) {
  const { t } = useLingui();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | null>(null);
  const pendingPick = useRef(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{
    query: string;
    options: FieldCompletion[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<Record<string, string>>(
    {},
  );
  const currentAnswer = open && answer?.query === query ? answer : null;
  const options = currentAnswer?.options ?? noOptions;
  const loading = open && !currentAnswer;
  useEffect(() => {
    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, id, options]);

  const labelFor = (value: string) =>
    selectedLabels[value] ?? valueLabels?.get(value) ?? valueLabel(value);

  const receiveAnswer = useEffectEvent(
    (answeredQuery: string, available: FieldCompletion[]) => {
      if (!open || answeredQuery !== query) return;
      setAnswer({ query, options: available });
      setActiveIndex(0);
      if (!pendingPick.current) return;
      pendingPick.current = false;
      const first = available[0];
      // A queued Enter may select a match. Using the raw text is explicit.
      if (first) add(first.value, first.label);
    },
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timeout = window.setTimeout(
      () => {
        void completeField({
          field,
          kind: completion.kind,
          query,
          limit: 12,
          targetTypes: completion.targetTypes,
          configuredValues: completion.values,
        }).then(
          (next) => {
            if (!active) return;
            const selected = new Set(
              values.map((value) => value.toLocaleLowerCase()),
            );
            const available = next.filter(
              (option) => !selected.has(option.value.toLocaleLowerCase()),
            );
            const used = available.filter(({ kind }) => kind === "value");
            receiveAnswer(
              query,
              usedFirst && !query.trim() && used.length ? used : available,
            );
          },
          () => {
            if (active) receiveAnswer(query, []);
          },
        );
      },
      completion.kind === "records" ? 160 : 40,
    );
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [completeField, completion, field, open, query, usedFirst, values]);

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  function add(value: string, label?: string) {
    const next = value.trim();
    if (!next) return;
    if (onPick) {
      if (query) changeQuery("");
      onPick(next, label ?? labelFor(next));
      return;
    }
    if (
      !values.some(
        (candidate) =>
          candidate.toLocaleLowerCase() === next.toLocaleLowerCase(),
      )
    ) {
      onChange?.([...values, next]);
      if (label)
        setSelectedLabels((current) => ({ ...current, [next]: label }));
      setAnnouncement(t`${label ?? labelFor(next)} added`);
    }
    if (query) changeQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function changeQuery(value: string) {
    pendingPick.current = false;
    setQuery(value);
    setAnswer(null);
    setActiveIndex(0);
  }

  function closeSuggestions() {
    pendingPick.current = false;
    setAnswer(null);
    setActiveIndex(0);
    setOpen(false);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
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
      if (onPick && loading) {
        event.preventDefault();
        if (event.key === "Enter") pendingPick.current = true;
        return;
      }
      if (!query.trim() && !options.length) return;
      event.preventDefault();
      const option = options[activeIndex];
      if (option) add(option.value, option.label);
      else if (!onPick || currentAnswer) add(query.replace(/,$/, ""));
      return;
    }
    if (event.key === "Backspace" && !query && values.length && !onPick) {
      const removed = values.at(-1);
      onChange?.(values.slice(0, -1));
      if (removed) setAnnouncement(t`${labelFor(removed)} removed`);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (onEscape) {
        // A typed value is kept, as it is when the field loses focus.
        if (query.trim() && !onPick) add(query);
        onEscape();
      } else if (open) closeSuggestions();
      else event.currentTarget.blur();
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
        {(onPick ? [] : values).map((value) => (
          <span className="field-token" key={value}>
            <span>{labelFor(value)}</span>
            <button
              aria-label={t`Remove ${labelFor(value)}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange?.(values.filter((candidate) => candidate !== value));
                setAnnouncement(t`${labelFor(value)} removed`);
              }}
            >
              <X aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
          </span>
        ))}
        <input
          aria-activedescendant={
            options[activeIndex] ? `${id}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={showOptions}
          autoComplete="off"
          autoFocus={autoFocus}
          id={`${id}-input`}
          placeholder={values.length && !onPick ? "" : placeholder}
          ref={inputRef}
          role="combobox"
          value={query}
          onBlur={() => {
            pendingPick.current = false;
            blurTimer.current = window.setTimeout(() => {
              blurTimer.current = null;
              if (query.trim() && !onPick) add(query);
              closeSuggestions();
            }, 120);
          }}
          onChange={(event) => {
            changeQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (blurTimer.current !== null) {
              window.clearTimeout(blurTimer.current);
              blurTimer.current = null;
            }
            setOpen(true);
          }}
          onKeyDown={keyDown}
        />
      </div>
      {showOptions ? (
        <div
          aria-label={t`${label} suggestions`}
          className="field-suggestions"
          id={`${id}-options`}
          role="listbox"
        >
          {loading ? (
            <span className="field-suggestion-status">
              <Trans>Looking in collection…</Trans>
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
              {t`Use “${query.trim()}”`}
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
