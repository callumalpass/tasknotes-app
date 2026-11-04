import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { describe, expect, it, vi } from "vitest";
import type { FieldCompletion } from "../domain/completion";
import type { CreateTaskInput } from "../domain/task";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskCapture } from "./task-capture";

const onboarding: FieldCompletion = {
  kind: "record",
  value: "[[Notes/How collections work|How collections work]]",
  label: "How collections work",
  detail: "Notes/How collections work.md",
};
const work: FieldCompletion = {
  kind: "record",
  value: "[[Projects/Work|Work]]",
  label: "Work",
  detail: "Projects/Work.md",
};

async function captureWith(suggestions: FieldCompletion[]) {
  const complete = vi.fn(async () => suggestions);
  const create = vi.fn(async (input: CreateTaskInput) =>
    new TaskNotesTaskModel().create(input, { id: crypto.randomUUID() }),
  );
  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={create}
      completeField={complete}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("New task title");
  const text = "Review launch +Work";
  await act(async () => {
    fireEvent.change(input, {
      target: { value: text, selectionStart: text.length },
    });
  });
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ query: "Work" }),
  );
  return { input, create };
}

describe("quick-add project Enter (real capture parser)", () => {
  it.each([
    { name: "only a substring note matches", suggestions: [onboarding] },
    { name: "an exact project also matches", suggestions: [onboarding, work] },
  ])("submits +Work unchanged when $name", async ({ suggestions }) => {
    const { input, create } = await captureWith(suggestions);
    // jsdom does not perform Enter's native form submission; first prove that
    // the handler leaves Enter unconsumed, then dispatch that default action.
    expect(fireEvent.keyDown(input, { key: "Enter", code: "Enter" })).toBe(
      true,
    );
    expect(input).toHaveValue("Review launch +Work");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        title: "Review launch",
        projects: ["Work"],
      }),
    );
  });

  it("still permits deliberate arrow-key selection of a substring match", async () => {
    const { input, create } = await captureWith([onboarding]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(input).toHaveValue(`Review launch +${onboarding.value} `);
    expect(create).not.toHaveBeenCalled();
  });
});

it("highlights ranked shorthand with an editable, removable priority chip and swatch", async () => {
  const configuration = defaultTaskCollectionConfiguration();
  const highest = [...configuration.priorities].sort(
    (a, b) => b.weight - a.weight,
  )[0];
  const { container } = render(
    <TaskCapture configuration={configuration} createTask={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("New task title"), {
    target: { value: "Call Rowan p1" },
  });
  const chip = await screen.findByRole("button", {
    name: `Edit ${highest.label}`,
  });
  expect(chip).toHaveTextContent(`Priority: ${highest.label}`);
  expect(chip.querySelector(".value-color")).toHaveStyle({
    backgroundColor: highest.color,
  });
  expect(container.querySelector("mark")).toHaveTextContent("p1");
  fireEvent.click(chip);
  expect(screen.getByRole("combobox", { name: "Priority" })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: `Remove ${highest.label}` }),
  );
  expect(container.querySelector("mark")).toBeNull();
});

it.each(["#", "@", "+", "!", "*"])(
  "offers keyboard completions for %s, with a selected option and Tab acceptance",
  async (trigger) => {
    const complete = vi.fn(async () => [
      { kind: "value" as const, value: "first", label: "First" },
      { kind: "value" as const, value: "second", label: "Second" },
    ]);
    const create = vi.fn();
    render(
      <TaskCapture
        configuration={defaultTaskCollectionConfiguration()}
        createTask={create}
        completeField={complete}
      />,
    );
    const input = screen.getByRole("combobox", { name: "New task title" });
    const text = `Call Rowan ${trigger}`;
    fireEvent.change(input, {
      target: { value: text, selectionStart: text.length },
    });
    const first = await screen.findByRole("option", { name: "First" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", first.parentElement!.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = screen.getByRole("option", { name: "Second" });
    expect(input).toHaveAttribute("aria-activedescendant", second.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue(`${text}first `);
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(create).not.toHaveBeenCalled();
  },
);
