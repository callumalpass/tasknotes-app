import { compileFilter } from "obsidian-bases-expression";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parse, stringify } from "yaml";

import type { ViewDialect } from "../domain/view-document";

export interface ExpressionField {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "date" | "list";
  options?: Array<{ value: string; label: string }>;
}

type RuleOperator =
  | "equals"
  | "not-equals"
  | "contains"
  | "not-contains"
  | "before"
  | "after"
  | "empty"
  | "not-empty";

interface FilterRule {
  kind: "rule";
  id: number;
  field: string;
  operator: RuleOperator;
  value: string;
}

interface FilterGroup {
  kind: "group";
  id: number;
  operator: "and" | "or";
  children: FilterNode[];
}

type FilterNode = FilterRule | FilterGroup;

interface BuilderState {
  mode: "visual" | "raw";
  root: FilterGroup;
  raw: string;
}

let nextId = 1;

export function ExpressionBuilder({
  value,
  dialect,
  fields,
  onChange,
  onValidityChange,
}: {
  value?: unknown;
  dialect: ViewDialect;
  fields: ExpressionField[];
  onChange(value: unknown): void;
  onValidityChange?(valid: boolean): void;
}) {
  const [state, setState] = useState<BuilderState>(() =>
    initialState(value, dialect),
  );
  const encoded = useMemo(
    () =>
      state.mode === "visual"
        ? encodeGroup(state.root)
        : rawFilter(state.raw, dialect),
    [dialect, state],
  );
  const error = useMemo(() => validate(encoded, dialect), [dialect, encoded]);
  useEffect(() => {
    onValidityChange?.(!error);
  }, [error, onValidityChange]);

  function change(next: BuilderState) {
    setState(next);
    onChange(
      next.mode === "visual"
        ? encodeGroup(next.root)
        : rawFilter(next.raw, dialect),
    );
  }

  return (
    <div className="expression-builder">
      <div
        className="expression-mode"
        role="group"
        aria-label="Filter editor mode"
      >
        {dialect === "obsidian-bases" ? (
          <button
            aria-pressed={state.mode === "visual"}
            type="button"
            onClick={() =>
              change({
                ...state,
                mode: "visual",
                root: decodeFilter(rawFilter(state.raw, dialect)) ?? state.root,
              })
            }
          >
            Builder
          </button>
        ) : null}
        <button
          aria-pressed={state.mode === "raw"}
          type="button"
          onClick={() =>
            change({
              ...state,
              mode: "raw",
              raw:
                state.mode === "visual"
                  ? filterSource(encodeGroup(state.root))
                  : state.raw,
            })
          }
        >
          Expression
        </button>
      </div>
      {state.mode === "visual" ? (
        <FilterGroupEditor
          fields={fields}
          group={state.root}
          root
          onChange={(root) => change({ ...state, root })}
        />
      ) : (
        <label className="expression-source">
          <span>
            {dialect === "mdbase-cel"
              ? "CEL expression"
              : "Expression or filter YAML"}
          </span>
          <textarea
            aria-label="Filter expression"
            rows={5}
            spellCheck={false}
            value={state.raw}
            onChange={(event) => change({ ...state, raw: event.target.value })}
          />
        </label>
      )}
      <p className={error ? "expression-status is-error" : "expression-status"}>
        {error || (encoded ? "Filter is valid" : "Every task will be included")}
      </p>
    </div>
  );
}

function FilterGroupEditor({
  group,
  fields,
  root = false,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  fields: ExpressionField[];
  root?: boolean;
  onChange(group: FilterGroup): void;
  onRemove?(): void;
}) {
  return (
    <fieldset className="filter-group">
      <legend>{root ? "Include tasks when" : "Nested group"}</legend>
      <div className="filter-group-heading">
        <select
          aria-label={root ? "Match mode" : "Nested match mode"}
          value={group.operator}
          onChange={(event) =>
            onChange({ ...group, operator: event.target.value as "and" | "or" })
          }
        >
          <option value="and">All conditions match</option>
          <option value="or">Any condition matches</option>
        </select>
        {!root ? (
          <button
            aria-label="Remove group"
            className="quiet-icon"
            type="button"
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
      <div className="filter-children">
        {group.children.map((child, index) =>
          child.kind === "rule" ? (
            <FilterRuleEditor
              fields={fields}
              key={child.id}
              rule={child}
              onChange={(rule) => onChange(replaceChild(group, index, rule))}
              onRemove={() => onChange(removeChild(group, index))}
            />
          ) : (
            <FilterGroupEditor
              fields={fields}
              group={child}
              key={child.id}
              onChange={(nested) =>
                onChange(replaceChild(group, index, nested))
              }
              onRemove={() => onChange(removeChild(group, index))}
            />
          ),
        )}
      </div>
      <div className="filter-add-actions">
        <button
          type="button"
          onClick={() => onChange(addChild(group, emptyRule(fields[0]?.key)))}
        >
          <Plus aria-hidden="true" size={15} /> Condition
        </button>
        <button
          type="button"
          onClick={() => onChange(addChild(group, emptyGroup(fields[0]?.key)))}
        >
          <Plus aria-hidden="true" size={15} /> Group
        </button>
      </div>
    </fieldset>
  );
}

function FilterRuleEditor({
  rule,
  fields,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  fields: ExpressionField[];
  onChange(rule: FilterRule): void;
  onRemove(): void;
}) {
  const field = fields.find((candidate) => candidate.key === rule.field);
  const noValue = rule.operator === "empty" || rule.operator === "not-empty";
  return (
    <div className="filter-rule">
      <label>
        <span>Property</span>
        <input
          aria-label="Filter property"
          list="view-filter-properties"
          value={rule.field}
          onChange={(event) => onChange({ ...rule, field: event.target.value })}
        />
      </label>
      <label>
        <span>Condition</span>
        <select
          aria-label="Filter condition"
          value={rule.operator}
          onChange={(event) =>
            onChange({ ...rule, operator: event.target.value as RuleOperator })
          }
        >
          <option value="equals">is</option>
          <option value="not-equals">is not</option>
          <option value="contains">contains</option>
          <option value="not-contains">does not contain</option>
          <option value="before">is before</option>
          <option value="after">is after</option>
          <option value="empty">is empty</option>
          <option value="not-empty">is not empty</option>
        </select>
      </label>
      {!noValue ? (
        <label>
          <span>Value</span>
          {field?.options?.length ? (
            <select
              aria-label="Filter value"
              value={rule.value}
              onChange={(event) =>
                onChange({ ...rule, value: event.target.value })
              }
            >
              <option value="">Choose…</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Filter value"
              inputMode={field?.type === "number" ? "decimal" : undefined}
              type={field?.type === "date" ? "date" : "text"}
              value={rule.value}
              onChange={(event) =>
                onChange({ ...rule, value: event.target.value })
              }
            />
          )}
        </label>
      ) : null}
      <button
        aria-label="Remove condition"
        className="quiet-icon"
        type="button"
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" size={16} />
      </button>
      <datalist id="view-filter-properties">
        {fields.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {candidate.label}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function initialState(value: unknown, dialect: ViewDialect): BuilderState {
  const decoded = dialect === "obsidian-bases" ? decodeFilter(value) : null;
  return {
    mode: decoded ? "visual" : "raw",
    root: decoded ?? emptyGroup(),
    raw: value === undefined ? "" : filterSource(value),
  };
}

function decodeFilter(value: unknown): FilterGroup | null {
  if (value === undefined || value === null || value === "")
    return emptyGroup();
  if (typeof value === "string") {
    const rule = decodeRule(value);
    return rule ? group("and", [rule]) : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [operator, children] = entries[0];
  if (operator !== "and" && operator !== "or") return null;
  const nodes = (Array.isArray(children) ? children : [children]).map(
    (child): FilterNode | null => {
      if (typeof child === "string") return decodeRule(child);
      return decodeFilter(child);
    },
  );
  return nodes.every(Boolean) ? group(operator, nodes as FilterNode[]) : null;
}

function decodeRule(source: string): FilterRule | null {
  const empty = source.match(/^!?([\w.:-]+)\.isEmpty\(\)$/);
  if (empty)
    return rule(empty[1], source.startsWith("!") ? "not-empty" : "empty", "");
  const contains = source.match(/^(!)?([\w.:-]+)\.contains\((.*)\)$/);
  if (contains)
    return rule(
      contains[2],
      contains[1] ? "not-contains" : "contains",
      decodeLiteral(contains[3]),
    );
  const comparison = source.match(/^([\w.:-]+)\s*(==|!=|<|>)\s*(.+)$/);
  if (!comparison) return null;
  return rule(
    comparison[1],
    { "==": "equals", "!=": "not-equals", "<": "before", ">": "after" }[
      comparison[2]
    ] as RuleOperator,
    decodeLiteral(comparison[3]),
  );
}

function encodeGroup(value: FilterGroup): unknown {
  const children = value.children.flatMap((child) => {
    const encoded =
      child.kind === "group" ? encodeGroup(child) : encodeRule(child);
    return encoded ? [encoded] : [];
  });
  if (!children.length) return undefined;
  if (children.length === 1) return children[0];
  return { [value.operator]: children };
}

function encodeRule(value: FilterRule): string | undefined {
  if (!value.field.trim()) return undefined;
  if (value.operator === "empty") return `${value.field}.isEmpty()`;
  if (value.operator === "not-empty") return `!${value.field}.isEmpty()`;
  const literal = encodeLiteral(value.value);
  if (value.operator === "contains")
    return `${value.field}.contains(${literal})`;
  if (value.operator === "not-contains")
    return `!${value.field}.contains(${literal})`;
  const operator = {
    equals: "==",
    "not-equals": "!=",
    before: "<",
    after: ">",
  }[value.operator];
  return `${value.field} ${operator} ${literal}`;
}

function encodeLiteral(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (value === "true" || value === "false" || value === "null") return value;
  return JSON.stringify(value);
}

function decodeLiteral(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function rawFilter(source: string, dialect: ViewDialect): unknown {
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  if (dialect === "mdbase-cel") return trimmed;
  try {
    const parsed = parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

function filterSource(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : stringify(value).trim();
}

function validate(value: unknown, dialect: ViewDialect): string {
  if (value === undefined) return "";
  if (dialect === "mdbase-cel")
    return typeof value === "string" ? "" : "Enter a CEL expression.";
  const invalid = compileFilter(value).diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  return invalid?.message ?? "";
}

function emptyRule(field = "status"): FilterRule {
  return rule(field, "equals", "open");
}

function emptyGroup(field?: string): FilterGroup {
  return group("and", field ? [emptyRule(field)] : []);
}

function rule(
  field: string,
  operator: RuleOperator,
  value: string,
): FilterRule {
  return { kind: "rule", id: nextId++, field, operator, value };
}

function group(operator: "and" | "or", children: FilterNode[]): FilterGroup {
  return { kind: "group", id: nextId++, operator, children };
}

function addChild(groupValue: FilterGroup, child: FilterNode): FilterGroup {
  return { ...groupValue, children: [...groupValue.children, child] };
}

function replaceChild(
  groupValue: FilterGroup,
  index: number,
  child: FilterNode,
): FilterGroup {
  return {
    ...groupValue,
    children: groupValue.children.map((candidate, candidateIndex) =>
      candidateIndex === index ? child : candidate,
    ),
  };
}

function removeChild(groupValue: FilterGroup, index: number): FilterGroup {
  return {
    ...groupValue,
    children: groupValue.children.filter(
      (_, candidateIndex) => candidateIndex !== index,
    ),
  };
}
