import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  registerPlugin: () => ({}),
}));

import { CollectionGate } from "./collection-gate";

beforeEach(() => {
  localStorage.clear();
});

it("gently recommends mdbase and lets native users choose a folder", () => {
  render(<CollectionGate />);

  const mdbase = screen.getByRole("button", { name: /mdbase/i });
  expect(mdbase).toHaveTextContent("Recommended");
  expect(mdbase).toHaveTextContent("Usually the easiest choice");

  fireEvent.click(screen.getByRole("button", { name: /On this device/i }));
  expect(
    screen.getByRole("heading", { name: "Use a folder for your tasks." }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Use the TaskNotes folder/i }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Choose an existing folder/i }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("heading", { name: "Where should your tasks live?" }),
  ).toBeVisible();
});
