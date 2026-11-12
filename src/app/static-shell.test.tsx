import { expect, it, vi } from "vitest";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";

import html from "../../index.html?raw";
import { act, render } from "../test/render";

vi.mock("./held-collection", () => ({ ReadyCollection: () => null }));

import { TaskNotesApp } from "./tasknotes-app";

/** Tags and classes in document order: what the stylesheet lays out. Hidden
 * headings and status lines take no space, and the mark's motion starts with
 * the app. */
function outline(root: Element): string[] {
  const lines: string[] = [];
  const visit = (element: Element, depth: number) => {
    const classes = [...element.classList].filter(
      (name) => !name.startsWith("mdbase-motion-"),
    );
    if (classes.includes("mdbase-collections-visually-hidden")) return;
    lines.push(
      `${"  ".repeat(depth)}${element.tagName.toLowerCase()}.${classes.join(".")}`,
    );
    for (const child of element.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines;
}

it("paints the gate's starting screen from index.html before any script runs", async () => {
  const shell = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("#root > main")!;

  const mdbase = await createTestMdbase({ phase: "signed_out" });
  const { container } = render(<TaskNotesApp mdbase={mdbase} />);
  act(() =>
    mdbase.fixture.controls.publishSnapshot({
      ...mdbase.fixture.mdbase.getSnapshot(),
      status: "starting",
    } as never),
  );
  const gate = container.querySelector('main[data-phase="starting"]')!;

  expect(outline(shell)).toEqual(outline(gate));
  for (const name of ["data-layout", "data-phase"])
    expect(shell.getAttribute(name)).toBe(gate.getAttribute(name));
  expect(shell.querySelector(".wordmark-label")!.textContent).toBe(
    gate.querySelector(".wordmark-label")!.textContent,
  );
  // The sentence is translated interface copy, so the shell only holds its
  // line open: the mark must not move when the app writes it.
  expect(gate.querySelector(".mdbase-opening-message p")!.textContent).toMatch(
    /\S/,
  );
  expect(
    shell.querySelector(".mdbase-opening-message p")!.textContent!.trim(),
  ).toBe("");
});
