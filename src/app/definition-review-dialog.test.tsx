import { fireEvent, render, screen } from "@testing-library/react";

import { DefinitionReviewDialog } from "./definition-review-dialog";

describe("DefinitionReviewDialog", () => {
  it("names the managed files and explains the portable receipt before adoption", () => {
    const decide = vi.fn();
    render(
      <DefinitionReviewDialog
        decide={decide}
        review={{
          kind: "adoption",
          request: {
            packId: "tasknotes.task",
            desiredVersion: "0.3.0-rc.9",
            message: "TaskNotes found older unmanaged contract definitions.",
            resources: [
              {
                path: "_contracts/tasknotes.task.md",
                currentDigest: `sha256:${"1".repeat(64)}`,
                desiredDigest: `sha256:${"2".repeat(64)}`,
              },
            ],
          },
        }}
      />,
    );

    expect(
      screen.getByRole("alertdialog", {
        name: "Let TaskNotes manage these definitions?",
      }),
    ).toBeVisible();
    expect(screen.getByText("_contracts/tasknotes.task.md")).toBeVisible();
    fireEvent.click(screen.getByText("What “manage” means"));
    expect(screen.getByText(/mdbase\.lock\.yaml/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Adopt and update" }));
    expect(decide).toHaveBeenCalledWith(true);
  });

  it("keeps cancellation focused by default and supports Escape", () => {
    const decide = vi.fn();
    render(
      <DefinitionReviewDialog
        decide={decide}
        review={{
          kind: "managed-upgrade",
          request: {
            typePath: "_types/task.md",
            message: "The generated task definition can be updated.",
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Not now" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(decide).toHaveBeenCalledWith(false);
  });
});
