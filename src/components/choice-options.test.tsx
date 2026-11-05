import { cleanup, fireEvent, render, screen } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceOptions } from "./choice-options";

afterEach(cleanup);
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
