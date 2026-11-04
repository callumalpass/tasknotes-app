import {
  Archive,
  CalendarClock,
  CalendarDays,
  ChartNoAxesGantt,
  Columns3,
  FolderKanban,
  Inbox,
  List,
  Sun,
  type LucideIcon,
} from "lucide-react";

import { starterViewKind } from "../../domain/default-view-source";
import type { TaskView } from "../../domain/view";

/**
 * One glyph per kind of destination. Layout decides first; TaskNotes' starter
 * Projects and Archive views share the plain list layout, so they are told
 * apart by name, and only inside the starter view source.
 */
export function taskViewIcon(view: TaskView): LucideIcon {
  const presentation = view.presentation;
  switch (presentation?.type) {
    case "tasknotes.projects":
      return FolderKanban;
    case "tasknotes.planner":
      return ChartNoAxesGantt;
    case "tasknotes.kanban":
      return Columns3;
    case "tasknotes.calendar":
    case "tasknotes.mini-calendar": {
      const calendarView = presentation.options?.calendarView;
      return typeof calendarView === "string" && calendarView.startsWith("list")
        ? CalendarClock
        : CalendarDays;
    }
  }
  if (presentation?.options?.sections === "day") return Sun;
  const starter = starterViewKind(view);
  if (starter === "inbox") return Inbox;
  if (starter === "projects") return FolderKanban;
  if (starter === "archive") return Archive;
  return List;
}
