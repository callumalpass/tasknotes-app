import { describe, expect, it } from "vitest";

import bundledManifest from "../generated/mdbase-app.json";
import { cloudConnect } from "./connect";

describe("TaskNotes mdbase connection", () => {
  it("passes the generated declaration inline instead of loading a native asset URL", () => {
    expect(Reflect.get(cloudConnect, "manifest")).toEqual(bundledManifest);
    expect(typeof Reflect.get(cloudConnect, "manifest")).toBe("object");
  });
});
