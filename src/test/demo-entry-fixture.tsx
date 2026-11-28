import { useState } from "react";
import { TaskNotesApp } from "../app/tasknotes-app";
import { DemoApp } from "../demo/demo-app";
import { demoTasks } from "../demo/demo-tasks";
import type { DemoSeed } from "../demo/demo-seed";
import { storeDemoSeed } from "../demo/store-dataset";
import { manyOptionsDefinition } from "./many-options-definition";

const largeCollection: DemoSeed = {
  tasks: (model) => demoTasks(model, 10_000),
  scratchpads: () => [],
};

const manyProjects: DemoSeed = {
  tasks: (model) => {
    const now = new Date().toISOString();
    return Array.from({ length: 10_000 }, (_, index) => {
      const project = String(Math.floor(index / 80) + 1).padStart(3, "0");
      const number = String((index % 80) + 1).padStart(2, "0");
      return model.create(
        {
          title: `Task ${project}-${number}`,
          projects: [`[[Projects/Project ${project}]]`],
        },
        { id: `project-task-${index}`, now },
      );
    });
  },
  scratchpads: () => [],
};

/** Original demo semantics, retained solely for local browser assertions.
 * This entry is unreachable and omitted outside the exact e2e build mode;
 * none of its behavior qualifies native source writes or model readiness.
 */
export function DemoEntryFixture() {
  if (
    import.meta.env.MODE !== "e2e" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  )
    throw new Error("Demo fixtures require a local e2e build.");
  // `?demo=store` opens the curated store-screenshot collection.
  const [demo] = useState(
    () => new URL(location.href).searchParams.get("demo") ?? "0",
  );
  const seed =
    demo === "store"
      ? storeDemoSeed
      : demo === "10000"
        ? largeCollection
        : demo === "projects-scale"
          ? manyProjects
          : undefined;
  const count = seed ? 1 : Number(demo);
  const many = new URL(location.href).searchParams.has("many-options");
  return count > 0 ? (
    <DemoApp
      adjustDefinition={many ? manyOptionsDefinition : undefined}
      count={count}
      seed={seed}
    />
  ) : (
    <TaskNotesApp />
  );
}
