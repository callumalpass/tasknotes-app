/**
 * Move a TaskNotes date or datetime by whole local calendar days while
 * preserving its time and offset suffix exactly.
 */
export function shiftTaskDate(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    Number.isNaN(date.valueOf()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return value;
  date.setDate(date.getDate() + days);
  const shifted = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `${shifted}${match[4]}`;
}
