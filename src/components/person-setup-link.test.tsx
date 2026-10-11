import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeNotificationLabel } from "../app/notification-label";
import { PersonSetupLink } from "./person-setup-link";

afterEach(cleanup);

it("names the person-record action without obsolete product branding", () => {
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

it("names the missing collection rather than the old product", () => {
  expect(
    changeNotificationLabel({ state: "not_connected", optedIn: false }),
  ).toBe("Open a collection first");
});
