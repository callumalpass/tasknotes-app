import { lazy, Suspense } from "react";

import { LoadingRows } from "../../components/loading";
import { MiniCalendarView } from "./mini-calendar-view";

import type { CalendarPreferences } from "../calendar-preferences";
import type { CalendarTaskEdit } from "../../domain/calendar-edit";
import type { TaskSummary } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

const TaskCalendarView = lazy(async () => ({
  default: (await import("../task-calendar-view")).TaskCalendarView,
}));

export function CalendarViewPresentation({
  execution,
  preferences,
  identityTasks,
  selected,
  selectedCreateValue,
  titleProperty,
  onSelect,
  onCreate,
  onOpen,
  onToggle,
  onEdit,
}: {
  execution: TaskViewExecution;
  preferences: CalendarPreferences;
  identityTasks: readonly TaskSummary[];
  selected: string;
  selectedCreateValue: string;
  titleProperty: string;
  onSelect(date: string, createValue?: string): void;
  onCreate(date: string, createValue?: string, timeEstimate?: number): void;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void;
  onEdit(task: TaskSummary, edit: CalendarTaskEdit): Promise<void>;
}) {
  return execution.view.presentation?.type === "tasknotes.calendar" ? (
    <Suspense fallback={<LoadingRows count={6} />}>
      <TaskCalendarView
        execution={execution}
        preferences={preferences}
        identityTasks={identityTasks}
        selected={selected}
        selectedCreateValue={selectedCreateValue}
        titleProperty={titleProperty}
        onSelect={onSelect}
        onCreate={onCreate}
        onOpen={onOpen}
        onToggle={onToggle}
        onEdit={onEdit}
      />
    </Suspense>
  ) : (
    <MiniCalendarView
      execution={execution}
      firstDay={preferences.firstDay}
      identityTasks={identityTasks}
      selected={selected}
      titleProperty={titleProperty}
      onSelect={onSelect}
      onCreate={onCreate}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
}
