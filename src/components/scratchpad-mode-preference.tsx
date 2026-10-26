import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  loadScratchpadDefaultMode,
  saveScratchpadDefaultMode,
  type ScratchpadMode,
} from "../app/scratchpad-preferences";
import { TaskNotesSelect } from "./tasknotes-controls";

export function ScratchpadModePreference() {
  const { t } = useLingui();
  const [mode, setMode] = useState(loadScratchpadDefaultMode);
  const [error, setError] = useState("");
  return (
    <>
      <TaskNotesSelect
        ariaLabel={t({ message: "Default Scratchpad mode" })}
        className="theme-picker"
        value={mode}
        options={[
          { value: "outline", label: t({ message: "Outline" }) },
          { value: "markdown", label: t({ message: "Write" }) },
        ]}
        onChange={(value) => {
          try {
            saveScratchpadDefaultMode(value as ScratchpadMode);
            setMode(value as ScratchpadMode);
            setError("");
          } catch {
            setError(
              t({ message: "Could not save the default mode on this device." }),
            );
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
