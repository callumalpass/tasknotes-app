export declare const TASKNOTES_QUERY_COMPILER_VERSION = 1;
export declare const TASKNOTES_QUERY_PARSER_VERSION = "0.3.0-rc.4";
type Literal = string | number | boolean | null;
export interface TaskNotesFilterCondition {
    readonly type: "condition";
    readonly id: string;
    readonly property: string;
    readonly operator: string;
    readonly value: Literal | readonly string[];
}
export interface TaskNotesFilterGroup {
    readonly type: "group";
    readonly id: string;
    readonly conjunction: "and" | "or";
    readonly children: readonly (TaskNotesFilterCondition | TaskNotesFilterGroup)[];
}
export interface TaskNotesQuerySort {
    readonly property: string;
    readonly direction: "asc" | "desc";
}
/** Caller supplies the actual catalogue field mapping, not guessed aliases.
 * Bases inputs read raw metadata with identity field names and no overriding
 * evaluation-context objects. Generic FilterQuery remains unsupported.
 * Typing declarations must come from the same captured catalogue/Bases context.
 */
export interface TaskNotesQueryBindings {
    readonly types: readonly string[];
    readonly fields: Readonly<Record<string, string>>;
    readonly filterQueryBasis: "raw" | "effective";
    /** Catalogue-derived native Timestamp fields for the matched type union. */
    readonly nativeTimestampFields: readonly string[];
    /** Fields typed by the actual Bases oracle context (dates/links/etc.). */
    readonly basesTypedFields: readonly string[];
}
export type TaskNotesQueryInput = {
    readonly dialect: "tasknotes-filter";
    readonly filter: TaskNotesFilterGroup;
    readonly sortKey?: string;
    readonly sortDirection?: "asc" | "desc";
    readonly groupKey?: string;
    readonly subgroupKey?: string;
} | {
    readonly dialect: "obsidian-bases";
    readonly filter?: unknown;
    readonly globalFilter?: unknown;
    readonly sort?: readonly TaskNotesQuerySort[];
    readonly groupProperty?: string;
    readonly computedProperties?: readonly unknown[];
    readonly properties?: readonly string[];
} | {
    readonly dialect: "mdbase-cel";
    readonly filter?: unknown;
};
export interface CompiledTaskNotesQuery {
    readonly compilerVersion: 1;
    readonly parserVersion: "0.3.0-rc.4";
    readonly query: {
        readonly types: string[];
        readonly where?: string;
    };
    readonly dependencies: readonly {
        readonly source: "raw" | "effective";
        readonly field: string;
    }[];
    /** Translation is NOT proof of index eligibility, authority, budgets or execution. */
    readonly requiresReplicaValidation: true;
}
export type TaskNotesQueryErrorCode = "invalid_input" | "query_budget" | "unsupported_dialect" | "unsupported_expression" | "unsupported_operator" | "unsupported_field" | "unsupported_sort" | "unsupported_group" | "unsupported_projection";
export declare class TaskNotesQueryError extends Error {
    readonly code: TaskNotesQueryErrorCode;
    constructor(code: TaskNotesQueryErrorCode);
}
/** All-or-error: unsupported subtrees never disappear from the query. */
export declare function compileTaskNotesQuery(input: TaskNotesQueryInput, bindings: TaskNotesQueryBindings): CompiledTaskNotesQuery;
export {};
