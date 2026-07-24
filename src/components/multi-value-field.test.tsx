import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { expect, it, vi } from "vitest";

import { MultiValueField } from "./multi-value-field";

it("selects record completions while preserving their portable link value", async () => {
  const complete = vi.fn(async () => [
    {
      kind: "record" as const,
      value: "[[Projects/Mobile]]",
      label: "Mobile roadmap",
      detail: "Projects/Mobile.md",
      path: "Projects/Mobile.md",
    },
  ]);

  render(<Harness complete={complete} />);
  const input = screen.getByRole("combobox", { name: "Projects" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "mob" } });
  fireEvent.click(
    await screen.findByRole("option", { name: /Mobile roadmap/ }),
  );

  expect(screen.getByText("Mobile")).toBeVisible();
  expect(screen.getByTestId("values")).toHaveTextContent(
    '["[[Projects/Mobile]]"]',
  );
  expect(complete).toHaveBeenLastCalledWith(
    expect.objectContaining({
      field: "projects",
      kind: "records",
      query: "mob",
      limit: 12,
    }),
  );
});

it("keeps free-form entry and keyboard removal lightweight", async () => {
  render(<Harness complete={async () => []} />);
  const input = screen.getByRole("combobox", { name: "Projects" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Unfiled" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("values")).toHaveTextContent('["Unfiled"]');

  fireEvent.keyDown(input, { key: "Backspace" });
  await waitFor(() =>
    expect(screen.getByTestId("values")).toHaveTextContent("[]"),
  );
});

function Harness({
  complete,
}: {
  complete: ComponentProps<typeof MultiValueField>["completeField"];
}) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <>
      <MultiValueField
        completion={{ kind: "records" }}
        completeField={complete}
        field="projects"
        label="Projects"
        placeholder="Website, Home"
        values={values}
        onChange={setValues}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}
