import { render, screen } from "../test/render";
import { describe, expect, it } from "vitest";

import { MarkdownPreview } from "./markdown-preview";

describe("MarkdownPreview", () => {
  it("renders GFM structure and safe external links", () => {
    render(
      <MarkdownPreview
        source={`## Release notes

- [x] Contract complete
- [ ] Mobile pass

| Area | State |
| --- | --- |
| App | Ready |

[Reference](https://example.com/docs)`}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Release notes" }),
    ).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    for (const checkbox of screen.getAllByRole("checkbox"))
      expect(checkbox).toBeDisabled();
    expect(screen.getByRole("table")).toBeVisible();
    const link = screen.getByRole("link", { name: "Reference" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("does not execute or inject raw HTML", () => {
    const { container } = render(
      <MarkdownPreview source={'<script>alert("no")</script>\n\n**Safe**'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("Safe")).toBeVisible();
  });

  it("resolves Obsidian image embeds through collection storage", async () => {
    const resolveImage = vi.fn(async () => null);
    render(
      <MarkdownPreview
        resolveImage={resolveImage}
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
      const { container } = render(
        <MarkdownPreview
          resolveImage={resolveImage}
          source={`![[Attachments/file.${extension}|Unsafe]]\n\n![Also unsafe](Attachments/file.${extension})`}
        />,
      );
      expect(container.querySelector("img, iframe, object, embed")).toBeNull();
      expect(resolveImage).not.toHaveBeenCalled();
    },
  );

  it("refuses active content returned for a raster filename", async () => {
    const resolveImage = vi.fn(
      async () => new Blob(["<svg/>"], { type: "image/svg+xml" }),
    );
    const { container } = render(
      <MarkdownPreview
        resolveImage={resolveImage}
        source="![[Attachments/disguised.png]]"
      />,
    );
    expect(await screen.findByText("Image preview unavailable")).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not treat active data URLs or malformed encoded paths as images", () => {
    const { container } = render(
      <MarkdownPreview source="![Unsafe](data:text/html,payload.png)\n\n![Broken](/__tasknotes_attachment__/%zz.png)" />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
