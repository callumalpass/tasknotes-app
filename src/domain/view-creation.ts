import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { parse } from "yaml";

import { kanbanPropertyName, kanbanPropertyRole } from "./kanban";
import { todayString } from "./task";
import { readViewDraft } from "./view-document";

import type { CreateTaskInput } from "./task";
import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskView, TaskViewSourceDocument } from "./view";

export type TaskCreationDefaults = Partial<CreateTaskInput>;

export interface ViewCreationPlan {
  defaults: TaskCreationDefaults;
  inferredProperties: string[];
  explicitProperties: string[];
}

/**
 * Derive a conservative creation plan from a saved view. Only conjunctions of
 * equalities and positive list membership are reversible. Everything else is
 * left for post-create verification by the view executor.
 */
export function createPlanForView(
  view: TaskView,
  source: TaskViewSourceDocument,
  configuration: TaskCollectionConfiguration,
  now = new Date(),
): ViewCreationPlan {
  const draft = readViewDraft(source, view.id);
  const sharedFilter = readSharedFilter(source);
  const inferred = new ConstraintSet();
  inferred.addFilter(sharedFilter, draft.dialect, now);
  inferred.addFilter(draft.filter, draft.dialect, now);

  const inferredDefaults = propertiesToCreateDefaults(
    inferred.values(),
    configuration,
  );
  const explicitValues = record(record(draft.options.create).defaults);
  const explicitDefaults = mergeTaskCreationDefaults(
    normalizeExplicitDefaults(explicitValues),
    propertiesToCreateDefaults(
      record(explicitValues.properties),
      configuration,
    ),
  );

  return {
    defaults: mergeTaskCreationDefaults(inferredDefaults, explicitDefaults),
    inferredProperties: inferred.propertyNames(),
    explicitProperties: Object.keys(explicitValues),
  };
}

/**
 * Apply view defaults before NLP/user values. Lists are combined so a tag
 * required by a view is not lost when capture text adds another tag.
 */
export function mergeTaskCreationDefaults(
  defaults: TaskCreationDefaults,
  input: CreateTaskInput,
): CreateTaskInput;
export function mergeTaskCreationDefaults(
  defaults: TaskCreationDefaults,
  input: TaskCreationDefaults,
): TaskCreationDefaults;
export function mergeTaskCreationDefaults(
  defaults: TaskCreationDefaults,
  input: TaskCreationDefaults,
): TaskCreationDefaults {
  const result: TaskCreationDefaults = {
    ...defaults,
    ...input,
    customProperties: {
      ...(defaults.customProperties ?? {}),
      ...(input.customProperties ?? {}),
    },
  };
  for (const key of ["tags", "projects", "contexts"] as const) {
    const combined = uniqueStrings([
      ...(defaults[key] ?? []),
      ...(input[key] ?? []),
    ]);
    if (combined.length || defaults[key] || input[key]) result[key] = combined;
  }
  if (!Object.keys(result.customProperties ?? {}).length)
    delete result.customProperties;
  return result;
}

export function propertiesToCreateDefaults(
  properties: Record<string, unknown>,
  configuration: TaskCollectionConfiguration,
): TaskCreationDefaults {
  let defaults: TaskCreationDefaults = {};
  for (const [property, value] of Object.entries(properties)) {
    const mapped = propertyCreateDefault(property, value, configuration);
    if (mapped) defaults = mergeTaskCreationDefaults(defaults, mapped);
  }
  return defaults;
}

function normalizeExplicitDefaults(
  values: Record<string, unknown>,
): TaskCreationDefaults {
  const defaults: TaskCreationDefaults = {};
  if (typeof values.status === "string") defaults.status = values.status;
  if (typeof values.priority === "string") defaults.priority = values.priority;
  if (typeof values.due === "string") defaults.due = values.due;
  if (typeof values.scheduled === "string")
    defaults.scheduled = values.scheduled;
  if (typeof values.body === "string") defaults.body = values.body;
  if (typeof values.timeEstimate === "number")
    defaults.timeEstimate = values.timeEstimate;
  for (const key of ["tags", "projects", "contexts"] as const)
    if (values[key] !== undefined) defaults[key] = listValue(values[key]);
  const customProperties = record(values.customProperties);
  if (Object.keys(customProperties).length)
    defaults.customProperties = structuredClone(customProperties);
  return defaults;
}

function propertyCreateDefault(
  property: string,
  value: unknown,
  configuration: TaskCollectionConfiguration,
): TaskCreationDefaults | null {
  const field = kanbanPropertyName(property, configuration.fieldMapping);
  const role = kanbanPropertyRole(property, configuration.fieldMapping);
  if (!field || !role) return null;
  if (role === "title")
    return typeof value === "string" && value.trim()
      ? { title: value.trim() }
      : null;
  if (role === "status")
    return typeof value === "string" ? { status: value } : null;
  if (role === "priority")
    return typeof value === "string" ? { priority: value } : null;
  if (role === "due" || role === "scheduled")
    return typeof value === "string" ? { [role]: value } : null;
  if (role === "tags" || role === "projects" || role === "contexts")
    return { [role]: listValue(value) };
  if (role === "time_estimate")
    return typeof value === "number" && Number.isFinite(value)
      ? { timeEstimate: value }
      : null;
  if (role === "completed" || role === "archived") return null;
  if (
    Array.isArray(value) &&
    configuration.userFields.find((candidate) => candidate.key === field)
      ?.type !== "list"
  )
    return null;
  return { customProperties: { [field]: structuredClone(value) } };
}

function readSharedFilter(source: TaskViewSourceDocument): unknown {
  if (source.format === "obsidian.base") {
    const document = record(parse(source.document));
    return document.filters;
  }
  return record(parseFrontmatter(source.document).frontmatter.query).where;
}

class ConstraintSet {
  private readonly constraints = new Map<string, unknown>();
  private readonly conflicts = new Set<string>();

  addFilter(filter: unknown, dialect: string, now: Date): void {
    const entries =
      dialect === "obsidian-bases"
        ? inferObsidianFilter(filter, now)
        : inferCelFilter(filter, now);
    for (const [property, value] of Object.entries(entries))
      this.add(property, value);
  }

  values(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.constraints].filter(
        ([property]) => !this.conflicts.has(property),
      ),
    );
  }

  propertyNames(): string[] {
    return [...this.constraints.keys()].filter(
      (property) => !this.conflicts.has(property),
    );
  }

  add(property: string, value: unknown): void {
    if (this.conflicts.has(property)) return;
    if (!this.constraints.has(property)) {
      this.constraints.set(property, structuredClone(value));
      return;
    }
    const current = this.constraints.get(property);
    if (Array.isArray(current) || Array.isArray(value)) {
      this.constraints.set(property, [
        ...listValue(current),
        ...listValue(value),
      ]);
      return;
    }
    if (!sameValue(current, value)) {
      this.constraints.delete(property);
      this.conflicts.add(property);
    }
  }
}

function inferObsidianFilter(
  filter: unknown,
  now: Date,
): Record<string, unknown> {
  if (typeof filter === "string") return inferExpression(filter, now);
  const value = record(filter);
  if (Array.isArray(value.and))
    return mergeInferred(
      value.and.map((child) => inferObsidianFilter(child, now)),
    );
  // An OR (or an unknown filter object) cannot imply any one branch.
  return {};
}

function inferCelFilter(filter: unknown, now: Date): Record<string, unknown> {
  if (typeof filter !== "string") return {};
  return mergeInferred(
    splitTopLevelConjunction(filter).map((part) => inferExpression(part, now)),
  );
}

function inferExpression(
  expression: string,
  now: Date,
): Record<string, unknown> {
  const source = stripOuterParentheses(expression.trim());
  if (containsTopLevel(source, "||")) return {};
  const conjunction = splitTopLevelConjunction(source);
  if (conjunction.length > 1)
    return mergeInferred(conjunction.map((part) => inferExpression(part, now)));

  const contains = /^([\w.:-]+)\.contains\((.+)\)$/.exec(source);
  if (contains) {
    const literal = parseLiteral(contains[2], now);
    return literal.ok ? { [contains[1]]: [literal.value] } : {};
  }
  const equality = /^([\w.:-]+)\s*==\s*(.+)$/.exec(source);
  if (!equality) return {};
  const literal = parseLiteral(equality[2], now);
  return literal.ok ? { [equality[1]]: literal.value } : {};
}

function mergeInferred(
  values: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const constraints = new ConstraintSet();
  for (const value of values)
    for (const [property, item] of Object.entries(value))
      constraints.add(property, item);
  return constraints.values();
}

function parseLiteral(
  source: string,
  now: Date,
): { ok: true; value: unknown } | { ok: false } {
  const value = stripOuterParentheses(source.trim());
  if (value === "today()") return { ok: true, value: todayString(now) };
  if (value === "true") return { ok: true, value: true };
  if (value === "false") return { ok: true, value: false };
  if (value === "null") return { ok: true, value: null };
  if (/^-?\d+(?:\.\d+)?$/.test(value))
    return { ok: true, value: Number(value) };
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch {
      return { ok: false };
    }
  }
  if (value.startsWith("'") && value.endsWith("'"))
    return { ok: true, value: value.slice(1, -1).replace(/''/g, "'") };
  return { ok: false };
}

function splitTopLevelConjunction(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\" && quote === '"') index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]")
      depth = Math.max(0, depth - 1);
    else if (depth === 0 && source.slice(index, index + 2) === "&&") {
      parts.push(source.slice(start, index).trim());
      start = index + 2;
      index += 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function containsTopLevel(source: string, operator: string): boolean {
  if (operator === "&&") return splitTopLevelConjunction(source).length > 1;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\" && quote === '"') index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]")
      depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      source.slice(index, index + operator.length) === operator
    )
      return true;
  }
  return false;
}

function stripOuterParentheses(source: string): string {
  let value = source;
  while (
    value.startsWith("(") &&
    value.endsWith(")") &&
    matchingOuterParentheses(value)
  )
    value = value.slice(1, -1).trim();
  return value;
}

function matchingOuterParentheses(source: string): boolean {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\" && quote === '"') index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0 && index !== source.length - 1) return false;
    }
  }
  return depth === 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function listValue(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return uniqueStrings(
    Array.isArray(value) ? value.map(String) : [String(value)],
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
