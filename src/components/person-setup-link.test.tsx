import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeNotificationLabel } from "../app/notification-label";
import { PersonSetupLink } from "./person-setup-link";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("names the person-record action without obsolete product branding", () => {
  vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", undefined); // isolate this no-override case from build-target configuration
  const onOpen = vi.fn();
  const href = "https://example.test/people";
  render(<PersonSetupLink href={href} onOpen={onOpen} />);
  const link = screen.getByRole("link", {
    name: "Choose or create your person record Opens in a new tab",
  });
  expect(link).toHaveAttribute("href", href);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(link);
  expect(onOpen).toHaveBeenCalledOnce();
});

it.each([
  "https://lab.mdbase-editor-lab.pages.dev",
  "https://editor.example.test",
  "https://editor-staging.mdbase.dev",
  "http://127.0.0.1:48219",
])(
  "uses the app-configured Editor origin %s, preserving the settings target",
  (origin) => {
    vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", origin);
    const href =
      "https://editor-lab.mdbase.dev/?server=https%3A%2F%2Fconnect-lab.example.test&collection=20000000-0000-4000-8000-000000000002&surface=settings#your-person";
    render(<PersonSetupLink href={href} onOpen={vi.fn()} />);
    const link = screen.getByRole("link", {
      name: "Choose or create your person record Opens in a new tab",
    });
    const target = new URL(link.getAttribute("href")!);
    const original = new URL(href);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe(original.pathname);
    expect(target.search).toBe(original.search);
    expect(target.hash).toBe("#your-person");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
);

it("names the missing collection rather than the old product", () => {
  expect(
    changeNotificationLabel({ state: "not_connected", optedIn: false }),
  ).toBe("Open a collection first");
});
