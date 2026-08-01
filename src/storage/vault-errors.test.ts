import { isMissingFileError } from "./vault-errors";

describe("isMissingFileError", () => {
  it("recognizes browser and Capacitor missing-file errors", () => {
    expect(
      isMissingFileError(new DOMException("File not found", "NotFoundError")),
    ).toBe(true);
    expect(
      isMissingFileError({
        code: "OS-PLUG-FILE-0008",
        message: "Operation failed.",
      }),
    ).toBe(true);
    expect(isMissingFileError(new Error("File does not exist"))).toBe(true);
  });

  it("does not hide storage and permission failures", () => {
    expect(
      isMissingFileError({
        code: "OS-PLUG-FILE-0007",
        message: "Permission denied",
      }),
    ).toBe(false);
    expect(isMissingFileError(new Error("Storage unavailable"))).toBe(false);
  });
});
