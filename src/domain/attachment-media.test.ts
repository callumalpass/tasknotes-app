import { describe, expect, it } from "vitest";
import { inlineImageMediaType } from "./attachment-media";

describe("inline attachment image types", () => {
  it.each([
    "html",
    "svg",
    "pdf",
    "txt",
    "__proto__",
    "constructor",
    "toString",
  ])(
    "keeps %s download-only regardless of a misleading MIME hint",
    (extension) => {
      expect(inlineImageMediaType(`file.${extension}`, "image/png")).toBeNull();
      expect(inlineImageMediaType(`file.${extension}`)).toBeNull();
    },
  );

  it("allows only the existing raster formats with matching or unknown MIME", () => {
    expect(inlineImageMediaType("IMAGE.PNG", "IMAGE/PNG; charset=binary")).toBe(
      "image/png",
    );
    expect(inlineImageMediaType("image.jpg")).toBe("image/jpeg");
    expect(inlineImageMediaType("image.heic", "image/heif")).toBe("image/heif");
    expect(inlineImageMediaType("image.png", "text/html")).toBeNull();
  });
});
