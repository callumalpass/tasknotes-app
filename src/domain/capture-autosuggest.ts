import { completionMatches } from "./completion";

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
        ? configuration.priorities.map(({ value, label }) => ({ value, label }))
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
    .filter((entry) => completionMatches(entry, request.query ?? ""))
    .slice(0, request.limit ?? 8);
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
