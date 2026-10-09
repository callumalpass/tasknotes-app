import { useState } from "react";

import { DemoApp } from "../demo/demo-app";
import { NextCollectionGate } from "./next-collection-gate";

export function TaskNotesApp({
  demoCount,
  embeddedDemo,
}: {
  demoCount: number;
  embeddedDemo: boolean;
}) {
  const [activeDemoCount] = useState(demoCount);

  return activeDemoCount > 0 ? (
    <DemoApp count={activeDemoCount} embedded={embeddedDemo} />
  ) : (
    <NextCollectionGate />
  );
}
