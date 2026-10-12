import { fireEvent, render, screen } from "@testing-library/react";
import { describeError } from "@mdbase-dev/sdk/describe";
import { describe, expect, it, vi } from "vitest";
import { ApplicationProblemNotice } from "./application-problem-notice";

describe("ApplicationProblemNotice", () => {
  // UX-009: "Try again" rendered as plain text looked like a control.
  it("shows an action label only as a working control", () => {
    const description = describeError("unavailable")!;
    expect(description.actionLabel).toBe("Try again");
    const { unmount } = render(
      <ApplicationProblemNotice alert description={description} />,
    );
    expect(screen.queryByText("Try again")).toBeNull();
    unmount();
    const retry = vi.fn();
    render(
      <ApplicationProblemNotice
        alert
        description={description}
        onAction={retry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
