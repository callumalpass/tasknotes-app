import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DurationField } from "./duration-field";

describe("DurationField", () => {
  it("presents simple ISO durations as ordinary values and units", () => {
    const changed = vi.fn();
    render(
      <DurationField label="Future horizon" value="P14D" onChange={changed} />,
    );

    fireEvent.change(screen.getByLabelText("Future horizon amount"), {
      target: { value: "21" },
    });
    expect(changed).toHaveBeenCalledWith("P21D");
  });

  it("preserves advanced values behind a source disclosure", () => {
    render(<DurationField label="Gap" value="P1DT2H" onChange={vi.fn()} />);

    expect(screen.getByText(/advanced duration:/i)).toHaveTextContent("P1DT2H");
    expect(
      screen.getByText("Advanced duration").closest("details"),
    ).toHaveAttribute("open");
  });
});
