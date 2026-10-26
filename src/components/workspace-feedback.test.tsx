import { render, screen } from "../test/render";
import { FeedbackNotice, WorkspaceFeedback } from "./workspace-feedback";

it("keeps save guidance and wrapping notices in the same layout host", () => {
  const { rerender } = render(
    <WorkspaceFeedback aboveMobileControls>
      <FeedbackNotice>
        <div className="collection-write-status is-visible">
          Saved on this device; waiting for sync
        </div>
      </FeedbackNotice>
    </WorkspaceFeedback>,
  );
  rerender(
    <WorkspaceFeedback aboveMobileControls>
      <FeedbackNotice>
        <div className="collection-write-status is-visible">
          Saved on this device; waiting for sync
        </div>
      </FeedbackNotice>
      <FeedbackNotice>
        <div className="undo-toast">
          Task added: a long title that wraps<button>Open</button>
        </div>
      </FeedbackNotice>
    </WorkspaceFeedback>,
  );
  const status = screen.getByText("Saved on this device; waiting for sync");
  const toast = screen.getByRole("button", { name: "Open" }).parentElement;
  expect(status.parentElement).toBe(toast?.parentElement);
  expect(status.parentElement).toHaveClass(
    "workspace-feedback",
    "is-above-mobile-controls",
  );
  expect(document.querySelectorAll(".workspace-feedback")).toHaveLength(1);
});
