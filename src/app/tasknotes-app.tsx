import { useState } from "react";

import { DemoApp } from "../demo/demo-app";
import { CollectionGate } from "./collection-gate";

export function TaskNotesApp({
  demoCount,
  embeddedDemo,
}: {
  demoCount: number;
  embeddedDemo: boolean;
}) {
  const [activeDemoCount, setActiveDemoCount] = useState(demoCount);

  return activeDemoCount > 0 ? (
    <DemoApp count={activeDemoCount} embedded={embeddedDemo} />
  ) : (
    <CollectionGate onTryDemo={() => setActiveDemoCount(30)} />
  );
}
