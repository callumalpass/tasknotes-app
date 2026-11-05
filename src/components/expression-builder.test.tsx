import { fireEvent, render, screen } from "../test/render";
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
      screen.getByText(/The builder cannot represent every condition/),
    ).toBeVisible();
    expect(
      screen.getByText("(Status is open) and (Has tag work)"),
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

  it("explains unsupported logical groups without rewriting their source", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={{ or: ['file.hasTag("work")', 'status == "open"'] }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByText("Any of: Has tag work; Status is open"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains unfamiliar expressions verbatim instead of inventing meaning", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={'file.name.startsWith("Plan")'}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByText('Advanced condition: file.name.startsWith("Plan")'),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });
});
