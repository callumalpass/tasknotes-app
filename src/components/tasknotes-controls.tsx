import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

export interface TaskNotesOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function TaskNotesSelect({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  disabled = false,
  placeholder = "Choose",
  className,
}: {
  value: string;
  options: readonly TaskNotesOption[];
  onChange(value: string): void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, rootRef, setOpen } = useDismissablePopover(triggerRef);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(
    Math.max(selectedIndex, firstEnabledIndex(options)),
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function openOptions() {
    setActiveIndex(
      selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options),
    );
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openOptions();
        return;
      }
      setActiveIndex((index) =>
        nextEnabledIndex(options, index, event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(
        event.key === "Home"
          ? firstEnabledIndex(options)
          : lastEnabledIndex(options),
      );
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div className={classes("tasknotes-select", className)} ref={rootRef}>
      <button
        aria-activedescendant={
          open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
        }
        aria-controls={`${id}-options`}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="tasknotes-control-trigger tasknotes-select-trigger"
        data-value={value}
        disabled={disabled}
        ref={triggerRef}
        role="combobox"
        type="button"
        onClick={() => (open ? setOpen(false) : openOptions())}
        onKeyDown={keyDown}
      >
        <span className={selected ? undefined : "is-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.7} />
      </button>
      {open ? (
        <>
          <PopoverScrim
            label={`Close ${ariaLabel ?? "options"}`}
            onClose={() => setOpen(false)}
          />
          <div
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="tasknotes-popover tasknotes-select-popover"
            id={`${id}-options`}
            role="listbox"
          >
            {ariaLabel ? (
              <span className="tasknotes-popover-title">{ariaLabel}</span>
            ) : null}
            <div className="tasknotes-option-list">
              {options.map((option, index) => (
                <button
                  aria-selected={option.value === value}
                  className={index === activeIndex ? "is-active" : undefined}
                  disabled={option.disabled}
                  id={`${id}-option-${index}`}
                  key={option.value}
                  role="option"
                  type="button"
                  onClick={() => choose(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? (
                      <small>{option.description}</small>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check aria-hidden="true" size={16} strokeWidth={1.8} />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TaskNotesSelectField({
  label,
  className,
  ...select
}: Omit<
  Parameters<typeof TaskNotesSelect>[0],
  "ariaLabel" | "ariaLabelledBy" | "className"
> & {
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={classes("form-field tasknotes-control-field", className)}>
      <span id={`${id}-label`}>{label}</span>
      <TaskNotesSelect
        {...select}
        ariaLabelledBy={`${id}-label`}
        className="tasknotes-field-control"
      />
    </div>
  );
}

export function TaskNotesCombobox({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  options: readonly TaskNotesOption[];
  onChange(value: string): void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { open, rootRef, setOpen } = useDismissablePopover(inputRef);
  const filtered = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      `${option.label}\n${option.value}`.toLocaleLowerCase().includes(query),
    );
  }, [options, value]);
  const displayValue =
    !open && value
      ? (options.find((option) => option.value === value)?.label ?? value)
      : value;
  const [activeIndex, setActiveIndex] = useState(0);

  function choose(index: number) {
    const option = filtered[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="tasknotes-combobox" ref={rootRef}>
      <input
        aria-activedescendant={
          open && filtered.length ? `${id}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={`${id}-options`}
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        value={displayValue}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  index + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          } else if (event.key === "Enter" && open && filtered.length) {
            event.preventDefault();
            choose(activeIndex);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && filtered.length ? (
        <div
          aria-label={`${ariaLabel} suggestions`}
          className="tasknotes-popover tasknotes-combobox-popover"
          id={`${id}-options`}
          role="listbox"
        >
          {filtered.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={index === activeIndex ? "is-active" : undefined}
              id={`${id}-option-${index}`}
              key={option.value}
              role="option"
              type="button"
              onClick={() => choose(index)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span>{option.label}</span>
              <small>{option.value}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TaskNotesDateTimeField({
  label,
  value,
  onChange,
  disabled = false,
  splitValue = splitLocalDateTime,
  combineValue = combineLocalDateTime,
}: {
  label: string;
  value?: string;
  onChange(value?: string): void;
  disabled?: boolean;
  splitValue?(value?: string): { date?: string; time?: string };
  combineValue?(date?: string, time?: string): string | undefined;
}) {
  const { date, time } = splitValue(value);
  return (
    <div className="form-field date-time-field tasknotes-control-field">
      <span>{label}</span>
      <div>
        <TaskNotesDatePicker
          ariaLabel={`${label} date`}
          disabled={disabled}
          value={date}
          onChange={(next) => onChange(combineValue(next, time))}
        />
        <TaskNotesTimePicker
          ariaLabel={`${label} time`}
          disabled={disabled || !date}
          value={time}
          onChange={(next) => onChange(combineValue(date, next))}
        />
      </div>
    </div>
  );
}

export function TaskNotesDateField({
  label,
  value,
  onChange,
  className,
  disabled = false,
}: {
  label: string;
  value?: string;
  onChange(value?: string): void;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={classes("form-field tasknotes-control-field", className)}>
      <span id={`${id}-label`}>{label}</span>
      <TaskNotesDatePicker
        ariaLabelledBy={`${id}-label`}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

export function TaskNotesDatePicker({
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  placeholder = "No date",
}: {
  value?: string;
  onChange(value?: string): void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, rootRef, setOpen } = useDismissablePopover(triggerRef);
  const selected = parseDateValue(value);
  const today = startOfDay(new Date());
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selected ?? today),
  );
  const [focusedDate, setFocusedDate] = useState(() => selected ?? today);
  const dateRefs = useRef(new Map<string, HTMLButtonElement>());
  const accessibleName = ariaLabel ?? "Date";

  function openCalendar() {
    const next = selected ?? today;
    setVisibleMonth(startOfMonth(next));
    setFocusedDate(next);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    dateRefs.current.get(dateValue(focusedDate))?.focus();
  }, [focusedDate, open, visibleMonth]);

  const days = calendarDays(visibleMonth);

  function choose(date: Date) {
    onChange(dateValue(date));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(date: Date) {
    setFocusedDate(date);
    if (
      date.getMonth() !== visibleMonth.getMonth() ||
      date.getFullYear() !== visibleMonth.getFullYear()
    )
      setVisibleMonth(startOfMonth(date));
  }

  return (
    <div className="tasknotes-date-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="tasknotes-control-trigger tasknotes-date-trigger"
        data-value={value ?? ""}
        disabled={disabled}
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openCalendar())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openCalendar();
          }
        }}
      >
        <CalendarDays aria-hidden="true" size={16} strokeWidth={1.65} />
        <span className={selected ? undefined : "is-placeholder"}>
          {selected ? shortDate(selected) : placeholder}
        </span>
      </button>
      {open ? (
        <>
          <PopoverScrim
            label={`Close ${accessibleName} calendar`}
            onClose={() => setOpen(false)}
          />
          <div
            aria-label={`${accessibleName} calendar`}
            className="tasknotes-popover tasknotes-calendar-popover"
            role="dialog"
          >
            <div className="tasknotes-calendar-heading">
              <button
                aria-label="Previous month"
                type="button"
                onClick={() =>
                  setVisibleMonth(
                    new Date(
                      visibleMonth.getFullYear(),
                      visibleMonth.getMonth() - 1,
                      1,
                    ),
                  )
                }
              >
                <ChevronLeft aria-hidden="true" size={18} />
              </button>
              <strong>{monthLabel(visibleMonth)}</strong>
              <button
                aria-label="Next month"
                type="button"
                onClick={() =>
                  setVisibleMonth(
                    new Date(
                      visibleMonth.getFullYear(),
                      visibleMonth.getMonth() + 1,
                      1,
                    ),
                  )
                }
              >
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tasknotes-calendar-weekdays" aria-hidden="true">
              {weekdayLabels().map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div className="tasknotes-calendar-grid" role="grid">
              {Array.from({ length: 6 }, (_, week) => (
                <div key={week} role="row">
                  {days.slice(week * 7, week * 7 + 7).map((day) => {
                    const key = dateValue(day);
                    const inMonth =
                      day.getMonth() === visibleMonth.getMonth() &&
                      day.getFullYear() === visibleMonth.getFullYear();
                    return (
                      <button
                        aria-label={longDate(day)}
                        aria-selected={value === key}
                        className={classes(
                          !inMonth && "is-outside",
                          sameDay(day, today) && "is-today",
                        )}
                        key={key}
                        data-date={key}
                        ref={(element) => {
                          if (element) dateRefs.current.set(key, element);
                          else dateRefs.current.delete(key);
                        }}
                        role="gridcell"
                        tabIndex={sameDay(day, focusedDate) ? 0 : -1}
                        type="button"
                        onClick={() => choose(day)}
                        onKeyDown={(event) => {
                          const movement = {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -7,
                            ArrowDown: 7,
                          }[event.key];
                          if (movement !== undefined) {
                            event.preventDefault();
                            moveFocus(addDays(day, movement));
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            moveFocus(addDays(day, -day.getDay()));
                          } else if (event.key === "End") {
                            event.preventDefault();
                            moveFocus(addDays(day, 6 - day.getDay()));
                          } else if (event.key === "PageUp") {
                            event.preventDefault();
                            moveFocus(addMonths(day, -1));
                          } else if (event.key === "PageDown") {
                            event.preventDefault();
                            moveFocus(addMonths(day, 1));
                          } else if (event.key === "Escape") {
                            setOpen(false);
                            triggerRef.current?.focus();
                          }
                        }}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="tasknotes-picker-actions">
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Clear
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => choose(today)}
              >
                Today
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TaskNotesTimePicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder = "Any time",
}: {
  value?: string;
  onChange(value?: string): void;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, rootRef, setOpen } = useDismissablePopover(triggerRef);
  const parsed = parseTimeValue(value);
  const now = new Date();
  const [hour, setHour] = useState(parsed?.hour ?? now.getHours());
  const [minute, setMinute] = useState(parsed?.minute ?? now.getMinutes());
  const hourRefs = useRef(new Map<number, HTMLButtonElement>());
  const minuteRefs = useRef(new Map<number, HTMLButtonElement>());

  function openTimePicker() {
    const next = parseTimeValue(value);
    setHour(next?.hour ?? new Date().getHours());
    setMinute(next?.minute ?? new Date().getMinutes());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      hourRefs.current.get(hour)?.scrollIntoView({ block: "center" });
      minuteRefs.current.get(minute)?.scrollIntoView({ block: "center" });
    });
  }, [hour, minute, open]);

  function updateSelection(nextHour: number, nextMinute: number) {
    setHour(nextHour);
    setMinute(nextMinute);
  }

  return (
    <div className="tasknotes-time-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="tasknotes-control-trigger tasknotes-time-trigger"
        data-value={value ?? ""}
        disabled={disabled}
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openTimePicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openTimePicker();
          }
        }}
      >
        <Clock3 aria-hidden="true" size={16} strokeWidth={1.65} />
        <span className={parsed ? undefined : "is-placeholder"}>
          {parsed ? timeLabel(parsed.hour, parsed.minute) : placeholder}
        </span>
      </button>
      {open ? (
        <>
          <PopoverScrim
            label={`Close ${ariaLabel}`}
            onClose={() => setOpen(false)}
          />
          <div
            aria-label={ariaLabel}
            className="tasknotes-popover tasknotes-time-popover"
            role="dialog"
          >
            <div className="tasknotes-time-heading">
              <span>Time</span>
              <strong>{timeLabel(hour, minute)}</strong>
            </div>
            <div className="tasknotes-time-columns">
              <TimeColumn
                label="Hour"
                max={23}
                refs={hourRefs}
                value={hour}
                onChange={(next) => updateSelection(next, minute)}
              />
              <TimeColumn
                label="Minute"
                max={59}
                refs={minuteRefs}
                value={minute}
                onChange={(next) => updateSelection(hour, next)}
              />
            </div>
            <div className="tasknotes-picker-actions">
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Clear
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  const current = new Date();
                  updateSelection(current.getHours(), current.getMinutes());
                }}
              >
                Now
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  onChange(timeValue(hour, minute));
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TimeColumn({
  label,
  value,
  max,
  refs,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  refs: RefObject<Map<number, HTMLButtonElement>>;
  onChange(value: number): void;
}) {
  return (
    <div>
      <span>{label}</span>
      <div aria-label={label} className="tasknotes-time-list" role="listbox">
        {Array.from({ length: max + 1 }, (_, index) => (
          <button
            aria-selected={index === value}
            key={index}
            ref={(element) => {
              if (element) refs.current?.set(index, element);
              else refs.current?.delete(index);
            }}
            role="option"
            tabIndex={index === value ? 0 : -1}
            type="button"
            onClick={() => onChange(index)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const next =
                (index + (event.key === "ArrowDown" ? 1 : -1) + max + 1) %
                (max + 1);
              onChange(next);
              refs.current?.get(next)?.focus();
            }}
          >
            {String(index).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  );
}

function PopoverScrim({ label, onClose }: { label: string; onClose(): void }) {
  return (
    <button
      aria-label={label}
      className="tasknotes-popover-scrim"
      tabIndex={-1}
      type="button"
      onClick={onClose}
    />
  );
}

function useDismissablePopover<T extends HTMLElement>(
  triggerRef: RefObject<T | null>,
): {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  rootRef: RefObject<HTMLDivElement | null>;
} {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open, triggerRef]);
  return { open, setOpen, rootRef };
}

function firstEnabledIndex(options: readonly TaskNotesOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabledIndex(options: readonly TaskNotesOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1)
    if (!options[index].disabled) return index;
  return -1;
}

function nextEnabledIndex(
  options: readonly TaskNotesOption[],
  current: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;
  let next = current;
  for (let attempts = 0; attempts < options.length; attempts += 1) {
    next = (next + direction + options.length) % options.length;
    if (!options[next].disabled) return next;
  }
  return current;
}

function splitLocalDateTime(value?: string): {
  date?: string;
  time?: string;
} {
  if (!value) return {};
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value);
  return match ? { date: match[1], time: match[2] } : {};
}

function combineLocalDateTime(
  date?: string,
  time?: string,
): string | undefined {
  if (!date) return undefined;
  return time ? `${date}T${time}` : date;
}

function parseDateValue(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.valueOf()) || dateValue(date) !== value
    ? null
    : date;
}

function parseTimeValue(
  value?: string,
): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function timeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeLabel(hour: number, minute: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
}

function calendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function weekdayLabels(): string[] {
  const start = new Date(2026, 0, 4);
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(
      addDays(start, index),
    ),
  );
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  target.setDate(Math.min(date.getDate(), daysInMonth(target)));
  return target;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dateValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function longDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function sameDay(left: Date, right: Date): boolean {
  return dateValue(left) === dateValue(right);
}

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
