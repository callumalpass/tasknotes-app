import { useCallback, useMemo, useState } from "react";
import { sectionCollapsed } from "../../application/section-preferences";
import { BoundedList } from "../../components/bounded-list";
import { TaskListSection } from "../../components/task-list-section";
import { ViewTaskRow } from "./view-task-row";
import type { Task } from "../../domain/task";
import type { TaskViewProperty, TaskViewRow } from "../../domain/view";

type Lane = {
  key: string;
  label?: string;
  className?: string;
  rows: TaskViewRow[];
};
type Entry = {
  key: string;
  lane: Lane;
  headerIndex: number;
  row?: TaskViewRow;
};
const getKey = (entry: Entry) => entry.key;
const estimate = (entry: Entry) => (entry.row ? 84 : 52);
export function VirtualTaskList({
  lanes,
  grouped,
  daySections,
  preferenceScope,
  properties,
  titleProperty,
  onOpen,
  onToggle,
}: {
  lanes: Lane[];
  grouped: boolean;
  daySections: boolean;
  preferenceScope?: string;
  properties: TaskViewProperty[];
  titleProperty: string;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void | Promise<unknown>;
}) {
  const [choices, setChoices] = useState<Map<string, boolean>>(() => new Map());
  const preferenceKey = useCallback(
    (lane: Lane) =>
      preferenceScope
        ? `tasknotes:section:${preferenceScope}:${lane.key}`
        : undefined,
    [preferenceScope],
  );
  const isCollapsed = useCallback(
    (lane: Lane) =>
      choices.get(lane.key) ?? sectionCollapsed(preferenceKey(lane)),
    [choices, preferenceKey],
  );
  const entries = useMemo(() => {
    const result: Entry[] = [];
    for (const lane of lanes) {
      if (!lane.rows.length) continue;
      const headerIndex = grouped ? result.length : -1;
      if (grouped)
        result.push({ key: `heading:${lane.key}`, lane, headerIndex });
      if (grouped && isCollapsed(lane)) continue;
      for (const row of lane.rows)
        result.push({
          key: JSON.stringify([lane.key, row.task.id]),
          lane,
          row,
          headerIndex,
        });
    }
    return result;
  }, [grouped, isCollapsed, lanes]);
  const relatedIndices = useCallback(
    (index: number) =>
      entries[index]?.headerIndex >= 0 ? [entries[index].headerIndex] : [],
    [entries],
  );
  return (
    <BoundedList
      items={entries}
      getKey={getKey}
      estimateSize={estimate}
      relatedIndices={relatedIndices}
      className={`task-list-view${daySections ? " day-task-sections" : ""}`}
      renderItem={(entry) =>
        entry.row ? (
          <ViewTaskRow
            row={entry.row}
            properties={properties}
            titleProperty={titleProperty}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ) : (
          <TaskListSection
            headingOnly
            className={entry.lane.className}
            laneKey={entry.lane.key}
            label={entry.lane.label ?? "Other"}
            count={entry.lane.rows.length}
            preferenceKey={preferenceKey(entry.lane)}
            collapsed={isCollapsed(entry.lane)}
            onCollapsedChange={(value) =>
              setChoices((previous) =>
                new Map(previous).set(entry.lane.key, value),
              )
            }
          >
            {null}
          </TaskListSection>
        )
      }
    />
  );
}
