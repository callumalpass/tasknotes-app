import { cleanup, fireEvent, render, screen } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceOptions } from "./choice-options";

afterEach(cleanup);

it("keeps the long-picker viewport when filtering to one or zero results", () => {
  const options = Array.from({ length: 12 }, (_, index) => ({
    value: `${index}`,
    label: index === 11 ? "Someday" : `Option ${index}`,
  }));
  const { container } = render(
    <ChoiceOptions
      options={options}
      value=""
      label="Status"
      onChoose={vi.fn()}
    />,
  );
  const filter = screen.getByRole("combobox", { name: "Filter Status" });
  expect(container.querySelector(".choice-options")).toHaveClass("is-long");
  fireEvent.change(filter, { target: { value: "Someday" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(container.querySelector(".choice-options")).toHaveClass("is-long");
  fireEvent.change(filter, { target: { value: "No match" } });
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(container.querySelector(".choice-options")).toHaveClass("is-long");
});

it("names a short picker and offers a visible close action before its search", () => {
  const close = vi.fn();
  const { container } = render(
    <ChoiceOptions
      label="Theme"
      value="light"
      options={[{ value: "light", label: "Light" }]}
      onChoose={vi.fn()}
      onClose={close}
    />,
  );
  expect(container.querySelector(".choice-options-header")).toHaveTextContent(
    "Theme",
  );
  expect(screen.getByRole("combobox", { name: "Filter Theme" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});

it("starts on the selected value and skips a disabled first match after filtering", () => {
  const choose = vi.fn();
  render(
    <ChoiceOptions
      label="Priority"
      value="current"
      options={[
        { value: "disabled", label: "Custom disabled", disabled: true },
        { value: "enabled", label: "Custom enabled" },
        { value: "current", label: "Current priority" },
      ]}
      onChoose={choose}
    />,
  );
  const filter = screen.getByRole("combobox", { name: "Filter Priority" });
  expect(filter).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { selected: true }).id,
  );
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(choose).toHaveBeenLastCalledWith("current");
  fireEvent.change(filter, { target: { value: "Custom" } });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(choose).toHaveBeenLastCalledWith("enabled");
});

it("filters arbitrary options immediately and chooses the active enabled match", () => {
  const choose = vi.fn();
  render(
    <ChoiceOptions
      label="Status"
      value=""
      options={[
        { value: "one", label: "Custom waiting", color: "#0066cc" },
        { value: "two", label: "Custom blocked", disabled: true },
        { value: "three", label: "Custom active" },
        { value: "four", label: "Unrelated" },
      ]}
      onChoose={choose}
    />,
  );
  const filter = screen.getByRole("combobox", { name: "Filter Status" });
  expect(filter).toHaveFocus();
  fireEvent.change(filter, { target: { value: "custom" } });
  expect(screen.queryByRole("option", { name: "Unrelated" })).toBeNull();
  fireEvent.keyDown(filter, { key: "ArrowDown" });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(choose).toHaveBeenLastCalledWith("three");
  fireEvent.keyDown(filter, { key: "Home" });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(choose).toHaveBeenLastCalledWith("one");
  fireEvent.change(filter, { target: { value: "no-such-option" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matches");
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(choose).toHaveBeenCalledTimes(2);
});
