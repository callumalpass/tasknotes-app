import { render, screen } from "@testing-library/react";
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

  it("explains an empty preview", () => {
    render(<MarkdownPreview source=" " />);
    expect(screen.getByText(/Nothing to preview yet/)).toBeVisible();
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
});
