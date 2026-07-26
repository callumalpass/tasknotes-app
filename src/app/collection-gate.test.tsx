import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: () => ({}),
}));

import { Capacitor } from "@capacitor/core";

import { CollectionGate } from "./collection-gate";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
});

it("gently recommends mdbase and lets native users choose a folder", () => {
  render(<CollectionGate />);

  const mdbase = screen.getByRole("button", { name: /mdbase/i });
  expect(mdbase).toHaveTextContent("Recommended");
  expect(mdbase).toHaveTextContent("Hosted sync can keep working offline");
  expect(
    screen.getByRole("button", { name: /On this device/i }),
  ).toHaveTextContent("Choose a folder and use its Markdown files directly");

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

it("describes browser storage without implying a user-visible folder", () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  render(<CollectionGate />);

  const local = screen.getByRole("button", { name: /On this device/i });
  expect(local).toHaveTextContent(
    "Keep the source Markdown in this browser on this device",
  );
  expect(local).not.toHaveTextContent("Choose a folder");
});
