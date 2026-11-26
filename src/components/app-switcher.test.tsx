import { fireEvent, render, screen, within } from "../test/render";
import { afterEach, describe, expect, it } from "vitest";
import { mcpSetupUrl } from "@mdbase-dev/ui/apps";

import {
  canShowAppSwitcher,
  TaskNotesAppSwitcher,
  taskNotesAppUrls,
} from "./app-switcher";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("taskNotesAppUrls", () => {
  it("resolves production, staging, and lab origins with explicit overrides", () => {
    expect(taskNotesAppUrls("production", undefined, undefined)).toEqual({
      editor: "https://editor.mdbase.dev",
      reader: "https://reader.mdbase.dev",
      writer: "https://writer.mdbase.dev",
      journal: "https://journal.mdbase.dev",
      tasknotes: "https://app.tasknotes.dev",
    });
    expect(taskNotesAppUrls("staging", undefined, undefined)).toEqual({
      editor: "https://editor-staging.mdbase.dev",
      reader: "https://staging.mdbase-reader.pages.dev",
      writer: "https://staging.mdbase-writer.pages.dev",
      journal: "https://staging.mdbase-journal.pages.dev",
      tasknotes: "https://staging.tasknotes.dev",
    });
    expect(
      taskNotesAppUrls(
        "lab",
        "https://lab.mdbase-editor-lab.pages.dev",
        "http://127.0.0.1:48218",
      ),
    ).toEqual({
      editor: "https://lab.mdbase-editor-lab.pages.dev",
      reader: "https://lab.mdbase-reader.pages.dev",
      writer: "https://lab.mdbase-writer.pages.dev",
      journal: "https://lab.mdbase-journal-lab.pages.dev",
      tasknotes: "http://127.0.0.1:48218",
    });
  });
});

describe("canShowAppSwitcher", () => {
  it("hides the mdbase app switcher in self-hosted mode and native iOS", () => {
    expect(canShowAppSwitcher("production", false, "web")).toBe(true);
    expect(canShowAppSwitcher("production", true, "android")).toBe(true);
    expect(canShowAppSwitcher("production", true, "ios")).toBe(false);
    expect(canShowAppSwitcher("self-hosted", false, "web")).toBe(false);
  });
});

describe("TaskNotesAppSwitcher", () => {
  it("opens the app switcher popup from the TaskNotes icon and carries collectionId", () => {
    render(
      <TaskNotesAppSwitcher
        collectionId="col_42"
        urls={taskNotesAppUrls("production", undefined, undefined)}
      />,
    );

    const trigger = screen.getByRole("button", { name: "TaskNotes" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { hidden: true });
    expect(menu).toHaveAttribute("aria-label", "mdbase apps");
    expect(menu).toHaveTextContent("Open this collection in");

    const current = within(menu).getByRole("menuitem", {
      name: /TaskNotes/,
      hidden: true,
    });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("aria-disabled", "true");
    expect(current).toHaveTextContent("Current");

    expect(
      within(menu).getByRole("menuitem", { name: /Editor/, hidden: true }),
    ).toHaveAttribute("href", "https://editor.mdbase.dev/?collection=col_42");
    expect(
      within(menu).getByRole("menuitem", { name: /Reader/, hidden: true }),
    ).toHaveAttribute("href", "https://reader.mdbase.dev/?collection=col_42");
    expect(
      within(menu).getByRole("menuitem", { name: /Writer/, hidden: true }),
    ).toHaveAttribute("href", "https://writer.mdbase.dev/?collection=col_42");
    expect(
      within(menu).getByRole("menuitem", { name: /Journal/, hidden: true }),
    ).toHaveAttribute("href", "https://journal.mdbase.dev/?collection=col_42");
    expect(
      within(menu).getByRole("menuitem", {
        name: /Your app here/,
        hidden: true,
      }),
    ).toHaveAttribute("href", "https://mdbase.dev/sdk/");

    const assistantsRow = within(menu).getByRole("menuitem", {
      name: /AI assistants/,
      hidden: true,
    });
    expect(assistantsRow).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(assistantsRow);
    const assistants = document.getElementById(
      assistantsRow.getAttribute("aria-controls") ?? "",
    )!;
    expect(assistants).toHaveAttribute("role", "menu");
    expect(
      within(assistants).getByRole("menuitem", {
        name: /Other AI clients/,
        hidden: true,
      }),
    ).toHaveAttribute("href", mcpSetupUrl);
    expect(
      within(assistants).getByRole("menuitem", {
        name: /Memory/,
        hidden: true,
      }),
    ).toHaveAttribute("href", "https://memory.mdbase.dev/");
  });

  it("shows the generic mdbase apps heading when no collection is connected", () => {
    render(
      <TaskNotesAppSwitcher
        urls={taskNotesAppUrls("production", undefined, undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "TaskNotes" }));
    const menu = screen.getByRole("menu", { hidden: true });
    expect(menu).toHaveAttribute("aria-label", "mdbase apps");
    expect(menu).toHaveTextContent("mdbase apps");
    expect(
      within(menu).getByRole("menuitem", { name: /Journal/, hidden: true }),
    ).toHaveAttribute("href", "https://journal.mdbase.dev/");
  });
});
