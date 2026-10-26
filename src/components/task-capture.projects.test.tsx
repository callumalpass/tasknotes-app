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
