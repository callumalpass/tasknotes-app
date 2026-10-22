import { describe, expect, it } from "vitest";

import { nativeBackAction } from "./navigation";

describe("native back navigation", () => {
  it("returns from task and secondary view details", () => {
    expect(nativeBackAction({ page: "task", id: "task" })).toBe("back");
    expect(
      nativeBackAction({ page: "views", key: "secondary" }, ["primary"]),
    ).toBe("back");
  });

  it("returns from a Settings section to the Settings overview", () => {
    expect(nativeBackAction({ page: "more", section: "behavior" })).toBe(
      "back",
    );
    expect(nativeBackAction({ page: "more" })).toBe("home");
  });

  it("returns top-level destinations to Today before exiting", () => {
    expect(nativeBackAction({ page: "search" })).toBe("home");
    expect(
      nativeBackAction({ page: "views", key: "primary" }, ["primary"]),
    ).toBe("home");
    expect(nativeBackAction({ page: "home" })).toBe("exit");
  });
});
