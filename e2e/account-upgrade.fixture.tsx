import { createRoot } from "react-dom/client";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { TaskNotesApp } from "../src/app/tasknotes-app";
import "../src/styles.css";

// Synthetic SDK state, not native/production authorization evidence.
const mdbase = await createTestMdbase({
  phase: { problem: "collection_migrating" },
});
createRoot(document.getElementById("root")!).render(
  <>
    <TaskNotesApp mdbase={mdbase} />
    <button onClick={() => mdbase.fixture.set("choosing")}>
      Complete upgrade fixture
    </button>
  </>,
);
