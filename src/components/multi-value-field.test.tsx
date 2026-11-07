import { fireEvent, render, screen, waitFor } from "../test/render";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

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

  expect(
    screen.getByRole("button", { name: "Remove Mobile roadmap" }),
  ).toBeVisible();
  expect(screen.getByTestId("values")).toHaveTextContent(
    '["[[Projects/Mobile]]"]',
  );
});

it("renders persisted record values with resolved titles instead of paths", () => {
  render(
    <Harness
      complete={async () => []}
      initialValues={["[[tasks/opaque-file-id]]"]}
      valueLabels={new Map([["[[tasks/opaque-file-id]]", "Readable title"]])}
    />,
  );

  expect(screen.getByText("Readable title")).toBeVisible();
  expect(screen.queryByText("opaque-file-id")).not.toBeInTheDocument();
});

it("renders markup-shaped free-form values literally without changing the saved value", async () => {
  render(<Harness complete={async () => []} />);
  const input = screen.getByRole("combobox", { name: "Projects" });
  const value = "Project <0/> <b>notes</b>";
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  const option = await screen.findByRole("option", { name: `Use “${value}”` });
  expect(option).toHaveTextContent(value);
  fireEvent.click(option);
  expect(screen.getByTestId("values")).toHaveTextContent(
    JSON.stringify([value]),
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
  initialValues = [],
  valueLabels,
}: {
  complete: ComponentProps<typeof MultiValueField>["completeField"];
  initialValues?: string[];
  valueLabels?: ReadonlyMap<string, string>;
}) {
  const [values, setValues] = useState<string[]>(initialValues);
  return (
    <>
      <MultiValueField
        completion={{ kind: "records" }}
        completeField={complete}
        field="projects"
        label="Projects"
        placeholder="Website, Home"
        values={values}
        valueLabels={valueLabels}
        onChange={setValues}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

describe("single choice", () => {
  const completion = { kind: "records" as const };
  const operations = {
    kind: "value" as const,
    value: "[[Projects/Operations]]",
    label: "Operations",
  };
  const note = {
    kind: "record" as const,
    value: "[[tasks/one]]",
    label: "Task one",
  };

  it("commits a pick at once and lists used values until something is typed", async () => {
    const onPick = vi.fn();
    render(
      <MultiValueField
        completeField={async () => [operations, note]}
        completion={completion}
        field="projects"
        label="Project"
        placeholder="Find a project"
        usedFirst
        values={[]}
        onPick={onPick}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: "Project" }));
    expect(
      await screen.findByRole("option", { name: "Operations" }),
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: "Task one" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(operations.value, "Operations");
  });

  it("waits for matches rather than committing the typed text", async () => {
    const onPick = vi.fn();
    render(
      <MultiValueField
        completeField={async () => [operations]}
        completion={completion}
        field="projects"
        label="Project"
        placeholder="Find a project"
        values={[]}
        onPick={onPick}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Project" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ope" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    await screen.findByRole("option", { name: "Operations" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(operations.value, "Operations");
  });
});
