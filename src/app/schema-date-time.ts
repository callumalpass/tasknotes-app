// Schema date-times are instants, unlike floating Scheduled/Due task dates.
export function splitSchemaDateTime(value?: string): {
  date?: string;
  time?: string;
} {
  const local = toLocalDateTime(value);
  if (!local) return {};
  const [date, time] = local.split("T");
  return { date, time };
}

export function combineSchemaDateTime(
  date?: string,
  time?: string,
): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time ?? "00:00"}:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
