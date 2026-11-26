import { fireEvent, render, screen } from "../test/render";
import { describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { ViewSortChoices } from "./view-sort-choices";

describe("ViewSortChoices", () => {
  it("offers Modified alongside the everyday sorts and reports the configured field", () => {
    const configuration = defaultTaskCollectionConfiguration();
    const onChoose = vi.fn();
    render(
      <ViewSortChoices
        configuration={configuration}
        disabled={false}
        sort={[{ property: "dateModified", direction: "desc" }]}
        onChoose={onChoose}
      />,
    );

    const modified = screen.getByRole("button", { name: "Modified" });
    expect(modified).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(modified);
    expect(onChoose).toHaveBeenCalledWith(
      configuration.fieldMapping.dateModified,
    );
  });
});
