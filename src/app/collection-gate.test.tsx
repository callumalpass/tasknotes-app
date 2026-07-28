import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const native = vi.hoisted(() => ({
  callbackUrl: null as string | null,
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(
      (_event: string, listener: (event: { url: string }) => void) => {
        if (native.callbackUrl)
          queueMicrotask(() => listener({ url: native.callbackUrl! }));
        return Promise.resolve({ remove: vi.fn() });
      },
    ),
    getLaunchUrl: vi.fn(() =>
      Promise.resolve(
        native.callbackUrl ? { url: native.callbackUrl } : undefined,
      ),
    ),
  },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    close: native.close,
    open: vi.fn(() => Promise.resolve()),
  },
}));

import { Capacitor } from "@capacitor/core";

import * as cloudConnect from "../cloud/connect";
import { CollectionGate } from "./collection-gate";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  native.callbackUrl = null;
  native.close.mockClear();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
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
    .spyOn(cloudConnect.cloudSession, "authorize")
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
  expect(authorize).toHaveBeenNthCalledWith(1, {
    collectionId: "hosted-after-adoption",
  });
  expect(authorize).toHaveBeenNthCalledWith(2, {
    collectionId: "hosted-after-adoption",
  });
  expect(
    localStorage.getItem("tasknotes:local-to-hosted-transfer:v1"),
  ).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toBeDisabled();
});

it("deduplicates a native callback delivered as both launch and open events", async () => {
  const callback =
    "dev.tasknotes.app://auth/mdbase/callback?code=approved&state=session";
  native.callbackUrl = callback;
  const connection = {
    collectionId: "collection-connected",
    info: () => ({
      collectionId: "collection-connected",
      displayName: "Connected tasks",
    }),
  };
  const complete = vi
    .spyOn(cloudConnect.cloudSession, "handleAuthorizationCallback")
    .mockResolvedValue(connection as never);

  render(<CollectionGate />);

  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
  expect(complete).toHaveBeenCalledWith(callback);
  expect(localStorage.getItem("tasknotes:collection-choice:v1")).toBe("cloud");
});

it("completes a web callback without trying to close a native browser", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  history.replaceState(
    null,
    "",
    "/auth/mdbase/callback?code=approved&state=web-session",
  );
  const connection = {
    collectionId: "collection-web",
    info: () => ({
      collectionId: "collection-web",
      displayName: "Web tasks",
    }),
  };
  const complete = vi
    .spyOn(cloudConnect.cloudSession, "handleAuthorizationCallback")
    .mockImplementation(async () => {
      history.replaceState(null, "", "/?collection=collection-web");
      return connection as never;
    });

  render(<CollectionGate />);

  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  expect(native.close).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/");
  expect(new URL(location.href).searchParams.get("collection")).toBe(
    "collection-web",
  );
});
