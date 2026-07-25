import { compileFormulaSet } from "obsidian-bases-expression";

import type { EditableComputedProperty, ViewDialect } from "./view-document";

export function validateComputedProperties(
  dialect: ViewDialect,
  properties: readonly EditableComputedProperty[],
): string {
  const names = new Map<string, EditableComputedProperty>();
  for (const property of properties) {
    const name = property.name.trim();
    if (!name) return "Give every computed property a name.";
    if (!property.expression.trim()) return `${name} needs an expression.`;
    if (names.has(name)) return `${name} is defined more than once.`;
    names.set(name, property);
  }

  const namespace = dialect === "obsidian-bases" ? "formula" : "projection";
  const dependencies = new Map<string, string[]>();
  for (const [name, property] of names) {
    const referenced = expressionReferences(property.expression, namespace);
    const unknown = referenced.find((dependency) => !names.has(dependency));
    if (unknown)
      return `${name} refers to an unknown computed property: ${unknown}.`;
    if (property.scope === "source") {
      const local = referenced.find(
        (dependency) => names.get(dependency)?.scope === "view",
      );
      if (local)
        return `${name} is shared by the file and cannot depend on the view-only property ${local}.`;
    }
    dependencies.set(name, referenced);
  }

  const cycle = dependencyCycle(dependencies);
  if (cycle)
    return `Computed properties contain a dependency cycle: ${cycle.join(" → ")}.`;

  if (dialect === "obsidian-bases") {
    const compiled = compileFormulaSet(
      Object.fromEntries(
        properties.map(({ name, expression }) => [name.trim(), expression]),
      ),
    );
    const error = compiled.diagnostics.find(
      ({ severity }) => severity === "error",
    );
    if (error) return error.message;
  }

  return "";
}

function expressionReferences(
  expression: string,
  namespace: "formula" | "projection",
): string[] {
  const references = new Set<string>();
  const dot = new RegExp(`\\b${namespace}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  for (const match of expression.matchAll(dot)) references.add(match[1]);

  const bracket = new RegExp(
    `\\b${namespace}\\s*\\[\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1\\s*\\]`,
    "g",
  );
  for (const match of expression.matchAll(bracket)) {
    try {
      const quote = match[1];
      const source =
        quote === '"' ? `"${match[2]}"` : `"${match[2].replace(/"/g, '\\"')}"`;
      references.add(String(JSON.parse(source)));
    } catch {
      references.add(match[2]);
    }
  }
  return [...references];
}

function dependencyCycle(
  dependencies: ReadonlyMap<string, readonly string[]>,
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Map<string, number>();
  const path: string[] = [];

  const visit = (name: string): string[] | null => {
    if (visited.has(name)) return null;
    const start = visiting.get(name);
    if (start !== undefined) return [...path.slice(start), name];
    visiting.set(name, path.length);
    path.push(name);
    for (const dependency of dependencies.get(name) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
    return null;
  };

  for (const name of dependencies.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}
