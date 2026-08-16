import { lazy, Suspense } from "react";

import { LoadingRows } from "../../components/loading";
import { MiniCalendarView } from "./mini-calendar-view";

import type { CalendarPreferences } from "../calendar-preferences";
import type { Task, UpdateTaskInput } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

const FullCalendarView = lazy(async () => ({
  default: (await import("../full-calendar-view")).FullCalendarView,
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
  onUpdate,
}: {
  execution: TaskViewExecution;
  preferences: CalendarPreferences;
  identityTasks: readonly Task[];
  selected: string;
  selectedCreateValue: string;
  titleProperty: string;
  onSelect(date: string, createValue?: string): void;
  onCreate(date: string, createValue?: string, timeEstimate?: number): void;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
  onUpdate(task: Task, input: UpdateTaskInput): Promise<void>;
}) {
  return execution.view.presentation?.type === "tasknotes.calendar" ? (
    <Suspense fallback={<LoadingRows count={6} />}>
      <FullCalendarView
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
        onUpdate={onUpdate}
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
