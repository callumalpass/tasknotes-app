import { parseAst, type Plugin } from "vite";

/** Node needs JSON import attributes, but Vite serves/bundles JSON as JavaScript.
 * Normalize only the packed UI's literal JSON imports before Vite import analysis;
 * catalogue data, IDs, runtime composition and the authenticated archive stay intact.
 */
export function uiCatalogueImports(): Plugin {
  return {
    name: "tasknotes-ui-json-imports",
    enforce: "pre",
    transform(code, id) {
      if (
        !id
          .split("?")[0]
          .replaceAll("\\", "/")
          .endsWith("/@mdbase-dev/ui/dist/i18n.js")
      )
        return;
      return { code: normalizeUiJsonImports(code), map: null };
    },
  };
}

export function normalizeUiJsonImports(code: string): string {
  const removals: [number, number][] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "ImportExpression") {
      const source = node.source as { value?: unknown; end: number };
      const options = node.options as { start: number; end: number } | null;
      if (
        typeof source.value === "string" &&
        source.value.endsWith(".json") &&
        options &&
        // Do not discard other import options or attributes.
        /^\{\s*with\s*:\s*\{\s*type\s*:\s*["']json["']\s*\}\s*\}$/.test(
          code.slice(options.start, options.end),
        )
      ) {
        removals.push([source.end, options.end]);
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(parseAst(code));
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) {
    code = code.slice(0, start) + code.slice(end);
  }
  return code;
}
