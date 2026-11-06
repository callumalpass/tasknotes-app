import { fireEvent, render, screen } from "../test/render";
import { describe, expect, it, vi } from "vitest";

import { ExpressionBuilder } from "./expression-builder";
import { compileFilter } from "obsidian-bases-expression";
import { parse } from "yaml";
import { taskNotesDefaultBaseDocument } from "../domain/default-view-source";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

const fields = [
  { key: "scheduled", label: "Scheduled", type: "date" as const },
  { key: "due", label: "Due", type: "date" as const },
  { key: "tags", label: "Tags", type: "list" as const },
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
        value={'note["status"] == "open" && file.name.startsWith("Plan")'}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByText(/The builder cannot represent every condition/),
    ).toBeVisible();
    expect(
      screen.getByText(
        '(Status is open) and (Advanced condition: file.name.startsWith("Plan"))',
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

  it("explains unsupported logical groups without rewriting their source", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={{ or: ['file.name.startsWith("Plan")', 'status == "open"'] }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByText(
        'Any of: Advanced condition: file.name.startsWith("Plan"); Status is open',
      ),
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

  it.each(["Today", "Upcoming"])(
    "opens built-in %s in Builder and round-trips without mutation",
    (name) => {
      const document = parse(
        taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
      );
      const value = document.views.find(
        (view: { name: string }) => view.name === name,
      ).filters;
      const onChange = vi.fn();
      render(
        <ExpressionBuilder
          dialect="obsidian-bases"
          fields={fields}
          value={value}
          onChange={onChange}
        />,
      );
      expect(screen.getByRole("button", { name: "Builder" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      const roundTrip = parse(
        (
          screen.getByRole("textbox", {
            name: "Filter expression",
          }) as HTMLTextAreaElement
        ).value,
      );
      expect(compileFilter(roundTrip).diagnostics).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Builder" }));
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("edits all/any dates relative to today without turning expressions into strings", () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={{
          or: [
            'date(note["scheduled"]).date() <= today()',
            'date(note["due"]).date() > today() + "7d"',
          ],
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getAllByRole("spinbutton", { name: "Days from today" })[0],
      { target: { value: "-2" } },
    );
    expect(onChange).toHaveBeenLastCalledWith({
      or: [
        'date(note["scheduled"]).date() <= today() - "2d"',
        'date(note["due"]).date() > today() + "7d"',
      ],
    });
    expect(compileFilter(onChange.mock.lastCall![0]).diagnostics).toEqual([]);
  });

  it("keeps an invalid relative date unsaveable instead of silently accepting it as today", () => {
    const validity = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={"date(due).date() <= today()"}
        onChange={vi.fn()}
        onValidityChange={validity}
      />,
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Days from today" }),
      { target: { value: "1.5" } },
    );
    expect(screen.getByText("Enter a whole number of days.")).toBeVisible();
    expect(validity).toHaveBeenLastCalledWith(false);
  });

  it.each(["==", "!=", "<", ">", "<=", ">="])(
    "round-trips fixed date comparison %s through both modes",
    (operator) => {
      const value = `date(note["due"]).date() ${operator} date("2026-11-06")`;
      const onChange = vi.fn();
      render(
        <ExpressionBuilder
          dialect="obsidian-bases"
          fields={fields}
          value={value}
          onChange={onChange}
        />,
      );
      expect(screen.getByRole("button", { name: "Builder" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      const source = screen.getByRole("textbox", {
        name: "Filter expression",
      }) as HTMLTextAreaElement;
      expect(parse(source.value)).toBe(value);
      expect(compileFilter(parse(source.value)).diagnostics).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Builder" }));
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(['"false"', '"42"'])(
    "preserves quoted literal type %s when another condition changes",
    (literal) => {
      const onChange = vi.fn();
      render(
        <ExpressionBuilder
          dialect="obsidian-bases"
          fields={fields}
          value={{
            and: [`title == ${literal}`, "date(due).date() == today()"],
          }}
          onChange={onChange}
        />,
      );
      fireEvent.change(
        screen.getByRole("spinbutton", { name: "Days from today" }),
        { target: { value: "1" } },
      );
      expect(onChange).toHaveBeenLastCalledWith({
        and: [`title == ${literal}`, 'date(due).date() == today() + "1d"'],
      });
    },
  );

  it.each([
    '  date(note["due"]).date() <= customClock()  ',
    "due == otherField",
    "status.contains(otherField)",
  ])("preserves unsupported source byte-for-byte: %s", (value) => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        dialect="obsidian-bases"
        fields={fields}
        value={value}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Builder" })).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Filter expression" }),
    ).toHaveValue(value);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
