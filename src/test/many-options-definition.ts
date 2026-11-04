const STATUSES = [
  "Inbox",
  "Triage",
  "Ready",
  "Waiting on client",
  "Waiting on legal",
  "Blocked",
  "Drafting",
  "In review",
  "Revising",
  "Approved",
  "Scheduled to ship",
  "Shipped",
];
const PRIORITIES = [
  "Critical",
  "Urgent",
  "Very high",
  "High",
  "Raised",
  "Elevated",
  "Medium",
  "Standard",
  "Normal",
  "Low",
  "Very low",
  "Someday",
];
const COLORS = [
  "#c2410c",
  "#b91c1c",
  "#a16207",
  "#4d7c0f",
  "#047857",
  "#0e7490",
  "#1d4ed8",
  "#6d28d9",
  "#a21caf",
  "#be123c",
  "#57534e",
  "#334155",
];

const slug = (label: string) => label.toLowerCase().replaceAll(" ", "-");

/** A collection with far more statuses and priorities than the defaults, for layout checks. */
export function manyOptionsDefinition(
  definition: Record<string, unknown>,
): Record<string, unknown> {
  const next = structuredClone(definition) as {
    schema?: {
      value?: {
        properties?: Record<string, { enum?: string[]; default?: string }>;
      };
    };
    implements?: Array<{
      binding?: Record<string, { default?: string; definitions?: unknown[] }>;
    }>;
  };
  const properties = next.schema?.value?.properties ?? {};
  const statuses = STATUSES.map((label, order) => ({
    value: slug(label),
    label,
    order,
    color: COLORS[order],
    ...(label === "Shipped" ? { is_completed: true } : {}),
  }));
  const priorities = PRIORITIES.map((label, index) => ({
    value: slug(label),
    label,
    weight: PRIORITIES.length - index,
    color: COLORS[index],
  }));
  if (properties.status) {
    properties.status.enum = statuses.map(({ value }) => value);
    properties.status.default = "inbox";
  }
  if (properties.priority) {
    properties.priority.enum = priorities.map(({ value }) => value);
    properties.priority.default = "normal";
  }
  for (const contract of next.implements ?? []) {
    contract.binding = {
      ...contract.binding,
      status: { default: "inbox", definitions: statuses },
      priority: { default: "normal", definitions: priorities },
    };
  }
  return next;
}
