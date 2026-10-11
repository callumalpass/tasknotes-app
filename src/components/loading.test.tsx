import { fireEvent, render, screen } from "@testing-library/react";
import { AppShellLoading, ScreenLoading } from "./loading";

it("keeps the original opening layout and collection action available during the UI import", () => {
  const changeCollection = vi.fn();
  const { container } = render(
    <AppShellLoading markUrl="/mark.svg" changeCollection={changeCollection} />,
  );
  expect(container.querySelector("main")).toHaveClass("opening-screen");
  expect(container.querySelectorAll(".loading-row")).toHaveLength(4);
  expect(changeCollection).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Choose another mdbase collection" }),
  );
  expect(changeCollection).toHaveBeenCalledOnce();
});
it("uses the existing screen/header and loading rows without stealing focus", () => {
  const { container, rerender } = render(
    <div>
      <input aria-label="Existing draft" />
    </div>,
  );
  const input = screen.getByRole("textbox", { name: "Existing draft" });
  input.focus();
  rerender(
    <div>
      <input aria-label="Existing draft" />
      <ScreenLoading />
    </div>,
  );
  expect(screen.getByLabelText("Loading view")).toHaveClass(
    "screen",
    "view-detail",
  );
  expect(container.querySelectorAll(".loading-row")).toHaveLength(6);
  expect(input).toHaveFocus();
});
