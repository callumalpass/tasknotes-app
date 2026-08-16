import type { TaskTimeEntry } from "./task";

export function moveCalendarTimeEntry(
  entries: readonly TaskTimeEntry[],
  index: number,
  start: Date,
  end: Date | null,
): TaskTimeEntry[] {
  const current = entries[index];
  if (!current) throw new Error("The tracked time entry no longer exists.");
  const next = [...entries];
  next[index] = {
    ...current,
    startTime: start.toISOString(),
    ...(current.endTime && end ? { endTime: end.toISOString() } : {}),
  };
  return next;
}

export function resizeCalendarTimeEntry(
  entries: readonly TaskTimeEntry[],
  index: number,
  end: Date,
): TaskTimeEntry[] {
  const current = entries[index];
  if (!current) throw new Error("The tracked time entry no longer exists.");
  const next = [...entries];
  next[index] = { ...current, endTime: end.toISOString() };
  return next;
}
