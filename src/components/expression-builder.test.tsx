import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExpressionBuilder } from "./expression-builder";

const fields = [
  { key: "title", label: "Title", type: "text" as const },
  {
    key: "status",
    label: "Status",
    type: "text" as const,
    options: [{ value: "open", label: "Open" }],
  },
];

describe("ExpressionBuilder", () => {
  it("never changes a filter just because the editor mode changes", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={'status == "open"'}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "Builder" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("locks the builder when advanced syntax cannot be converted safely", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={'note["status"] == "open" && file.hasTag("work")'}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByText(
        "This filter uses advanced syntax. Edit it here to preserve it exactly.",
      ),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("starts a new condition on Status without inventing a value", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Condition" }));

    expect(
      screen.getByRole("combobox", { name: "Filter property" }),
    ).toHaveValue("Status");
    expect(
      screen.getByRole("combobox", { name: "Filter value" }),
    ).toHaveTextContent("Choose…");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
