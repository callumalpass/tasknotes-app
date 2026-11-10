import { createContext, useContext } from "react";

import type {
  TaskRowRelation,
  TaskRowRelations,
} from "../domain/task-row-relations";

export const TaskRowRelationsContext = createContext<TaskRowRelations>({});

/** What a row may say about its task's subtasks and open blockers. */
export function useTaskRowRelation(id: string): TaskRowRelation | undefined {
  return useContext(TaskRowRelationsContext)[id];
}
