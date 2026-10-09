import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";

vi.mock("./next-collection-gate", () => ({
  NextCollectionGate: () => <main>Original synced collection gate</main>,
}));
vi.mock("../demo/demo-app", () => {
  throw new Error("Production entry must not import the demo app");
});

import { TaskNotesApp } from "./tasknotes-app";

it.each(["/", "/?demo=50", "/?demo=5000", "/embed/", "/embed/?demo=12"])(
  "keeps %s on the original gate without a demo bypass",
  (route) => {
    window.history.replaceState(null, "", route);
    render(
      <StrictMode>
        <TaskNotesApp />
      </StrictMode>,
    );
    expect(screen.getByText("Original synced collection gate")).toBeVisible();
  },
);
