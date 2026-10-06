import { fireEvent, render, screen } from "../test/render";
import { describe, expect, it, vi } from "vitest";

import { DependencyEditor } from "./dependency-editor";

describe("DependencyEditor", () => {
  it("adds record links with the contract default relationship", async () => {
    const onChange = vi.fn();
    render(
      <DependencyEditor
        dependencies={[]}
        field="blockedBy"
        completeField={async () => [
          {
            kind: "record",
            label: "Draft proposal",
            value: "[[tasks/Draft proposal]]",
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Blocked by" }));
    expect(
      await screen.findByRole("option", { name: /Draft proposal/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Draft proposal/ }));

    expect(onChange).toHaveBeenCalledWith([
      {
        uid: "[[tasks/Draft proposal]]",
        reltype: "FINISHTOSTART",
      },
    ]);
  });

  it("edits relationship type and gap without changing the dependency uid", () => {
    const onChange = vi.fn();
    render(
      <DependencyEditor
        dependencies={[
          {
            uid: "[[tasks/Blocker]]",
            reltype: "FINISHTOSTART",
          },
        ]}
        field="blockedBy"
        completeField={async () => []}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Relationship" }));
    fireEvent.click(screen.getByRole("option", { name: "Start to start" }));
    expect(onChange).toHaveBeenCalledWith([
      {
        uid: "[[tasks/Blocker]]",
        reltype: "STARTTOSTART",
      },
    ]);

    fireEvent.change(screen.getByLabelText("Gap amount"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      {
        uid: "[[tasks/Blocker]]",
        reltype: "FINISHTOSTART",
        gap: "P2D",
      },
    ]);
  });
});
