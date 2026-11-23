import { undo } from "@codemirror/commands";
import type { ReactNode } from "react";
import { act, render, screen } from "../test/render";
import { changeNotes, notesView } from "../test/task-notes-editor";
import { TaskNotesEditor } from "./task-notes-editor";

const noteSection = (editor: ReactNode) => (
  <section>
    <h2 id="task-notes-title">Notes</h2>
    {editor}
  </section>
);
const renderNotes = (editor: ReactNode) => render(noteSection(editor));
const unavailable = async () => null;

describe("TaskNotesEditor", () => {
  it("uses the shared preview for ordinary Markdown and Obsidian formatting without opening vault links", () => {
    const source =
      "**A bolded heading**\n\n[[Some Note#Some heading|Section]]\n\n> [!summary]+ Summary\n> Details\n\n- [x] Ready\n\n| Area | State |\n| --- | --- |\n| App | Ready |\n\n[Reference][docs]\n\n[docs]: https://example.com/docs";
    const { container } = renderNotes(
      <TaskNotesEditor
        source={source}
        onChange={vi.fn()}
        resolveImage={unavailable}
      />,
    );
    expect(screen.getByText("A bolded heading")).toHaveClass("cm-lp-strong");
    expect(screen.getByText("Section").closest("a")).toBeNull();
    expect(screen.getByText("Summary").closest(".cm-lp-callout")).toBeVisible();
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(container.querySelector(".cm-lp-table")).toBeVisible();
    const link = container.querySelector("a");
    expect(link).toHaveTextContent("Reference");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(notesView().state.doc.toString()).toBe(source);
  });

  it("updates the same editor without echoing an incoming value, and keeps user undo", () => {
    const onChange = vi.fn();
    const view = renderNotes(
      <TaskNotesEditor
        source="**First**"
        onChange={onChange}
        resolveImage={unavailable}
      />,
    );
    const editor = notesView();
    view.rerender(
      noteSection(
        <TaskNotesEditor
          source={"**Remote**\r\nSecond"}
          onChange={onChange}
          resolveImage={unavailable}
        />,
      ),
    );
    expect(notesView()).toBe(editor);
    expect(onChange).not.toHaveBeenCalled();
    changeNotes(editor.contentDOM, "**Edited**\nSecond");
    expect(onChange).toHaveBeenLastCalledWith("**Edited**\r\nSecond");
    act(() => {
      undo(editor);
    });
    expect(onChange).toHaveBeenLastCalledWith("**Remote**\r\nSecond");
  });

  it("does not open private paths or remote images in the self-hosted app", () => {
    vi.stubEnv("MODE", "self-hosted");
    const resolveImage = vi.fn(unavailable);
    try {
      const { container } = renderNotes(
        <TaskNotesEditor
          source={
            "![remote](https://example.test/private.png) [notes](secret/note.md) [site](https://example.test/page)"
          }
          onChange={vi.fn()}
          resolveImage={resolveImage}
        />,
      );
      expect(container.querySelector("img:not(.cm-widgetBuffer)")).toBeNull();
      expect(resolveImage).not.toHaveBeenCalled();
      expect(container.querySelectorAll("a")).toHaveLength(1);
      expect(container.querySelector("a")).toHaveAttribute(
        "href",
        "https://example.test/page",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not inject HTML, decorate code as images, or load non-raster data URLs", () => {
    const resolveImage = vi.fn(unavailable);
    const { container } = renderNotes(
      <TaskNotesEditor
        source={
          '<script>alert("no")</script>\n\n`![Code](Attachments/example.png)`\n\n![Unsafe](data:text/html,payload.png)'
        }
        onChange={vi.fn()}
        resolveImage={resolveImage}
      />,
    );
    expect(
      container.querySelector(
        "script, img:not(.cm-widgetBuffer), iframe, object, embed",
      ),
    ).toBeNull();
    expect(resolveImage).not.toHaveBeenCalled();
  });

  it("resolves Obsidian image embeds through collection storage", async () => {
    const resolveImage = vi.fn(async () => null);
    renderNotes(
      <TaskNotesEditor
        resolveImage={resolveImage}
        onChange={vi.fn()}
        source={"Before\n\n![[Attachments/receipt photo.jpg|Receipt]]"}
      />,
    );

    expect(await screen.findByText("Image unavailable offline")).toBeVisible();
    expect(resolveImage).toHaveBeenCalledWith(
      "[[Attachments/receipt photo.jpg]]",
    );
    expect(screen.getByRole("img", { name: "Receipt" })).toBeVisible();
  });

  it.each(["html", "svg", "pdf", "txt"])(
    "never renders a %s attachment inline, including Obsidian embeds",
    (extension) => {
      const resolveImage = vi.fn(
        async () => new Blob(["untrusted"], { type: "image/png" }),
      );
      const { container } = renderNotes(
        <TaskNotesEditor
          resolveImage={resolveImage}
          onChange={vi.fn()}
          source={`![[Attachments/file.${extension}|Unsafe]]\n\n![Also unsafe](Attachments/file.${extension})`}
        />,
      );
      expect(
        container.querySelector(
          "img:not(.cm-widgetBuffer), iframe, object, embed",
        ),
      ).toBeNull();
      expect(resolveImage).not.toHaveBeenCalled();
    },
  );

  it("refuses active content returned for a raster filename", async () => {
    const resolveImage = vi.fn(
      async () => new Blob(["<svg/>"], { type: "image/svg+xml" }),
    );
    const { container } = renderNotes(
      <TaskNotesEditor
        resolveImage={resolveImage}
        onChange={vi.fn()}
        source="![[Attachments/disguised.png]]"
      />,
    );
    expect(await screen.findByText("Image preview unavailable")).toBeVisible();
    expect(container.querySelector("img:not(.cm-widgetBuffer)")).toBeNull();
  });
});
