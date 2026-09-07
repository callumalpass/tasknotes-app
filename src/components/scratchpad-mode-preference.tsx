import { useState } from "react";
import {
  loadScratchpadDefaultMode,
  saveScratchpadDefaultMode,
  type ScratchpadMode,
} from "../app/scratchpad-preferences";
import { TaskNotesSelect } from "./tasknotes-controls";

export function ScratchpadModePreference() {
  const [mode, setMode] = useState(loadScratchpadDefaultMode);
  const [error, setError] = useState("");
  return (
    <>
      <TaskNotesSelect
        ariaLabel="Default Scratchpad mode"
        className="theme-picker"
        value={mode}
        options={[
          { value: "outline", label: "Outline" },
          { value: "markdown", label: "Write" },
        ]}
        onChange={(value) => {
          try {
            saveScratchpadDefaultMode(value as ScratchpadMode);
            setMode(value as ScratchpadMode);
            setError("");
          } catch {
            setError("Could not save the default mode on this device.");
          }
        }}
      />
      {error ? (
        <p role="alert" className="inline-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
