import { completionMatches, linkDisplayLabel, linkTarget } from "./completion";

import type { CreateTaskInput } from "./task";
import type { FieldCompletion, FieldCompletionRequest } from "./completion";
import type { TaskCollectionConfiguration } from "./task-configuration";
import type { NlpTriggerConfig } from "@tasknotes/model/types";

const FALLBACK_CAPTURE_TRIGGERS: NlpTriggerConfig[] = [
  { propertyId: "tags", trigger: "#", enabled: true },
  { propertyId: "contexts", trigger: "@", enabled: true },
  { propertyId: "projects", trigger: "+", enabled: true },
  { propertyId: "status", trigger: "*", enabled: true },
  { propertyId: "priority", trigger: "!", enabled: true },
];

export interface ActiveCaptureToken {
  propertyId: string;
  trigger: string;
  query: string;
  start: number;
  end: number;
}

export function captureTriggers(
  configuration: TaskCollectionConfiguration,
): NlpTriggerConfig[] {
  return (configuration.nlp?.triggers ?? FALLBACK_CAPTURE_TRIGGERS)
    .filter(
      (entry) =>
        entry.enabled &&
        entry.propertyId.trim().length > 0 &&
        entry.trigger.length > 0,
    )
    .map((entry) => ({ ...entry }));
}

export function activeCaptureToken(
  text: string,
  cursor: number,
  triggers: NlpTriggerConfig[],
): ActiveCaptureToken | undefined {
  const position = Math.max(0, Math.min(text.length, cursor));
  let start = position;
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  let end = position;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;
  const token = text.slice(start, position);
  const match = [...triggers]
    .sort((left, right) => right.trigger.length - left.trigger.length)
    .find((entry) => token.startsWith(entry.trigger));
  if (!match) return undefined;
  return {
    propertyId: match.propertyId,
    trigger: match.trigger,
    query: token.slice(match.trigger.length),
    start,
    end,
  };
}

export function captureSuggestionRequest(
  token: ActiveCaptureToken,
  configuration: TaskCollectionConfiguration,
): FieldCompletionRequest | undefined {
  const userField = configuration.userFields.find(
    (field) => field.id === token.propertyId,
  );
  const mappedField =
    token.propertyId in configuration.fieldMapping
      ? configuration.fieldMapping[
          token.propertyId as keyof TaskCollectionConfiguration["fieldMapping"]
        ]
      : undefined;
  const field =
    token.propertyId === "tags" ? "tags" : (mappedField ?? userField?.key);
  if (!field) return undefined;

  const configuredValues =
    token.propertyId === "status"
      ? configuration.statuses.map(({ value, label }) => ({ value, label }))
      : token.propertyId === "priority"
        ? [...configuration.priorities]
            .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0))
            .map(({ value, label }) => ({ value, label }))
        : userField?.options;
  const completion = configuration.fieldCompletions[field];
  return {
    field,
    kind: completion?.kind ?? "values",
    query: token.query,
    limit: 8,
    targetTypes: completion?.targetTypes,
    configuredValues: configuredValues ?? completion?.values,
  };
}

export function configuredCaptureSuggestions(
  request: FieldCompletionRequest,
): FieldCompletion[] {
  return (request.configuredValues ?? [])
    .map(({ value, label }) => ({
      kind: "value" as const,
      value,
      label: label?.trim() || value,
    }))
    .filter((entry) => completionMatches(entry, request.query ?? ""));
}

export function applyCaptureSuggestion(
  text: string,
  token: ActiveCaptureToken,
  value: string,
): { text: string; cursor: number } {
  const normalizedValue = value.startsWith(token.trigger)
    ? value.slice(token.trigger.length)
    : value;
  const replacement = `${token.trigger}${normalizedValue}`;
  const suffix = text.slice(token.end);
  const separator = suffix.length === 0 ? " " : "";
  const next = `${text.slice(0, token.start)}${replacement}${separator}${suffix}`;
  return {
    text: next,
    cursor: token.start + replacement.length + separator.length,
  };
}

/** What a suggestion puts in the text: a link is written by name, not as markup. */
export function captureSuggestionText({ value }: FieldCompletion): string {
  if (linkTarget(value) === value) return value;
  const label = linkDisplayLabel(value);
  return /\s/u.test(label) ? `[[${label}]]` : label;
}

/**
 * Points a project typed by name at the project already called that, so
 * `+Operations` joins Operations rather than starting a second project with
 * the same name. A name that is new or ambiguous is kept as typed.
 */
export async function linkCapturedProjects(
  input: CreateTaskInput,
  configuration: TaskCollectionConfiguration,
  completeField: (
    request: FieldCompletionRequest,
  ) => Promise<FieldCompletion[]>,
): Promise<CreateTaskInput> {
  if (!input.projects?.length) return input;
  const field = configuration.fieldMapping.projects;
  const completion = configuration.fieldCompletions[field];
  const projects = await Promise.all(
    input.projects.map(async (project) => {
      const query = linkDisplayLabel(project);
      const name = query.toLocaleLowerCase();
      const matches = await completeField({
        field,
        kind: completion?.kind ?? "records",
        query,
        limit: 12,
        targetTypes: completion?.targetTypes,
      }).catch(() => []);
      const named = matches.filter(
        ({ value, label }) =>
          label.toLocaleLowerCase() === name ||
          linkDisplayLabel(value).toLocaleLowerCase() === name,
      );
      const used = named.filter(({ kind }) => kind === "value");
      const candidates = new Set(
        (used.length ? used : named).map(({ value }) => value),
      );
      return candidates.size === 1 ? [...candidates][0] : project;
    }),
  );
  return { ...input, projects };
}
