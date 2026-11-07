import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "../test/render";
import { afterEach, expect, it } from "vitest";
import { OutlineTextarea } from "./outline-textarea";

afterEach(cleanup);
it("keeps reference labels while focused and offers explicit source editing", () => {
  function Editor() {
    const [value, setValue] = useState(
      "Before [[Tasks/parent.md|Parent task]] after",
    );
    return (
      <OutlineTextarea
        aria-label="Note"
        value={value}
        onValueChange={setValue}
      />
    );
  }
  const { container } = render(<Editor />);
  const input = screen.getByRole("textbox", { name: "Note" });
  fireEvent.focus(input);
  expect(input).toHaveValue("Before Parent task after");
  expect(container.querySelector(".outline-link")).toHaveTextContent(
    "Parent task",
  );
  fireEvent.change(input, {
    target: { value: "Before Parent task afterwards" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit reference Markdown" }),
  );
  expect(input).toHaveValue(
    "Before [[Tasks/parent.md|Parent task]] afterwards",
  );
});
