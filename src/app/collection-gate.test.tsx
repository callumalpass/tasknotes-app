import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: () => ({}),
}));

import { Capacitor } from "@capacitor/core";

import * as cloudConnect from "../cloud/connect";
import { CollectionGate } from "./collection-gate";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
});

it("explains why mdbase is recommended and lets native users choose a folder", () => {
  render(<CollectionGate />);

  const mdbase = screen.getByRole("button", { name: /mdbase/i });
  expect(mdbase).toHaveTextContent("Best experience");
  expect(mdbase).toHaveTextContent("Faster search and saved views");
  expect(mdbase).toHaveTextContent(
    "mdbase delivers reminders while TaskNotes is closed",
  );
  expect(
    screen.getByRole("button", { name: /On this device/i }),
  ).toHaveTextContent("Reminder details are saved");

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
    screen.getByRole("heading", {
      name: "Choose how TaskNotes stores your tasks.",
    }),
  ).toBeVisible();
});

it("warns before using browser storage", () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  render(<CollectionGate />);

  const local = screen.getByRole("button", { name: /On this device/i });
  expect(local).toHaveTextContent(
    "Keep Markdown in this browser on this device",
  );
  expect(local).not.toHaveTextContent("Choose a folder");

  fireEvent.click(local);
  expect(
    screen.getByRole("heading", { name: "Keep tasks in this browser?" }),
  ).toBeVisible();
  expect(screen.getByRole("note")).toHaveTextContent(
    "Notifications are not available",
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "Clearing its site data can also remove",
  );

  fireEvent.click(screen.getByRole("button", { name: "Use this browser" }));
  expect(localStorage.getItem("tasknotes:collection-choice:v1")).toBe("local");
  expect(
    screen.queryByRole("heading", { name: "Keep tasks in this browser?" }),
  ).not.toBeInTheDocument();
});

it("keeps an adopted collection recoverable when authorization retry fails", async () => {
  localStorage.setItem("tasknotes:collection-choice:v1", "local");
  localStorage.setItem(
    "tasknotes:local-to-hosted-transfer:v1",
    JSON.stringify({
      sourceLocation: { mode: "default" },
      adoptedCollectionId: "hosted-after-adoption",
      displayName: "Hosted tasks",
    }),
  );
  const authorize = vi
    .spyOn(cloudConnect, "authorizeCloudCollection")
    .mockRejectedValueOnce(new Error("Initial authorization failed."))
    .mockRejectedValueOnce(new Error("Retry authorization failed."));

  render(<CollectionGate />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Initial authorization failed.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry transfer" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Retry authorization failed.",
    ),
  );
  expect(authorize).toHaveBeenNthCalledWith(1, "hosted-after-adoption");
  expect(authorize).toHaveBeenNthCalledWith(2, "hosted-after-adoption");
  expect(
    localStorage.getItem("tasknotes:local-to-hosted-transfer:v1"),
  ).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toBeDisabled();
});
