import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./app-error-boundary";

afterEach(() => vi.restoreAllMocks());

it("offers a safe restart when a screen cannot render", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <AppErrorBoundary>
      <BrokenScreen />
    </AppErrorBoundary>,
  );
  expect(
    screen.getByRole("heading", { name: "TaskNotes needs to restart." }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Restart TaskNotes" }),
  ).toBeVisible();
  expect(screen.getByText("render exploded")).toBeInTheDocument();
});

function BrokenScreen(): never {
  throw new Error("render exploded");
}
