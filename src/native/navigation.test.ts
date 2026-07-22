import { describe, expect, it } from "vitest";

import { nativeBackAction } from "./navigation";

describe("native back navigation", () => {
  it("returns from task and secondary view details", () => {
    expect(nativeBackAction({ page: "task", id: "task" })).toBe("back");
    expect(
      nativeBackAction({ page: "views", key: "secondary" }, "primary"),
    ).toBe("back");
  });

  it("returns top-level destinations to Today before exiting", () => {
    expect(nativeBackAction({ page: "search" })).toBe("home");
    expect(nativeBackAction({ page: "views", key: "primary" }, "primary")).toBe(
      "home",
    );
    expect(nativeBackAction({ page: "today" })).toBe("exit");
  });
});
