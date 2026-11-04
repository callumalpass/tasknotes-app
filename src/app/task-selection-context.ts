import { createContext } from "react";
import type { TaskSelectionStore } from "./task-selection-store";
export const SelectionContext = createContext<TaskSelectionStore | null>(null);
export const SelectableContext = createContext(false);
