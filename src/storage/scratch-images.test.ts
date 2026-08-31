import { describe, expect, it } from "vitest";
import {
  scratchImageFromRecord,
  scratchImageFrontmatter,
} from "./scratch-images";

const digest = `sha256:${"a".repeat(64)}` as const;

describe("scratch image records", () => {
  it("maps typed metadata without a scratchpad parent", () => {
    const input = {
      id: "image-1",
      path: "scratch-images/image-1.md",
      dateCreated: "2026-03-01T00:00:00.000Z",
      file: "Scratchpad Images/image-1.png",
      digest,
      size: 42,
      mediaType: "image/png",
      width: 2,
      height: 3,
    };
    const frontmatter = scratchImageFrontmatter(input);
    expect(
      scratchImageFromRecord({ path: input.path, revision: "r1", frontmatter }),
    ).toEqual(
      expect.objectContaining({
        kind: "image",
        id: "image-1",
        file: input.file,
        digest,
        size: 42,
        width: 2,
        height: 3,
      }),
    );
  });

  it("rejects invalid descriptors", () => {
    expect(() =>
      scratchImageFromRecord({
        path: "bad.md",
        revision: "1",
        frontmatter: {
          type: "tasknotes-scratch-image",
          id: "bad",
          dateCreated: "now",
          dateModified: "now",
          file: "x",
          digest: "bad",
          size: -1,
          mediaType: "image/png",
        },
      }),
    ).toThrow(/digest/);
  });
});
