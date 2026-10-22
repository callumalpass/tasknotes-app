import { describe, expect, it, vi } from "vitest";

import {
  appGrantReturnPath,
  deliverAppGrantReturn,
  isAppGrantReturn,
} from "./app-grant-return";

const uris = [
  "https://app.tasknotes.dev/auth/mdbase/callback",
  "dev.tasknotes.app://auth/mdbase/callback",
];

describe("Private collection grant return", () => {
  it("returns to the first redirect URI on this origin, else the root", () => {
    expect(appGrantReturnPath("https://app.tasknotes.dev", uris)).toBe(
      "/auth/mdbase/callback",
    );
    expect(appGrantReturnPath("http://127.0.0.1:48220", uris)).toBe("/");
  });

  it("recognises only a result on the return path", () => {
    const at = (path: string) =>
      isAppGrantReturn(new URL(path, "https://app.tasknotes.dev"), uris);
    expect(at("/auth/mdbase/callback?state=s&code=c")).toBe(true);
    expect(at("/auth/mdbase/callback?state=s&error=access_denied")).toBe(true);
    expect(at("/auth/mdbase/callback?state=s")).toBe(false);
    expect(at("/auth/mdbase/callback")).toBe(false);
    expect(at("/?state=s&code=c")).toBe(false);
  });

  it("hands the full URL to the SDK's callback delivery", async () => {
    const deliverAppGrantCallback = vi.fn();
    const url = new URL(
      "https://app.tasknotes.dev/auth/mdbase/callback?state=s&code=c",
    );
    await deliverAppGrantReturn(url, async () => ({ deliverAppGrantCallback }));
    expect(deliverAppGrantCallback).toHaveBeenCalledWith(url.href);
  });
});
