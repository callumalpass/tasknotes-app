import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(async () => undefined),
}));
vi.mock("@capacitor/browser", () => ({ Browser: native }));
vi.mock("@capacitor/app", () => ({ App: native }));
import {
  followNativeSignInReturn,
  isNativeSignInReturn,
  nativeSignIn,
  TASKNOTES_NATIVE_RETURN_URL,
} from "./sign-in";
import type { Mdbase } from "@mdbase-dev/sdk";

it("opens the system browser with the manifest-declared native return", async () => {
  expect(nativeSignIn.returnUrl).toBe(TASKNOTES_NATIVE_RETURN_URL);
  await nativeSignIn.open("https://connect.example.test/sign-in");
  expect(native.open).toHaveBeenCalledWith({
    url: "https://connect.example.test/sign-in",
  });
});
it.each([
  "https://evil.test",
  "dev.tasknotes.app://evil/mdbase/callback",
  "dev.tasknotes.app://auth/other",
  "dev.tasknotes.app://user@auth/mdbase/callback",
  "dev.tasknotes.app://auth/mdbase/callback#code",
])("ignores unrelated callback %s", (url) => {
  expect(isNativeSignInReturn(url)).toBe(false);
});
it("warm return wakes the same SDK owner; URL codes are never exchanged", async () => {
  const remove = vi.fn(async () => {});
  let returned!: (event: { url: string }) => void;
  native.addListener.mockImplementation((_name, listener) => {
    returned = listener;
    return Promise.resolve({ remove });
  });
  const mdbase = { setForeground: vi.fn() } as unknown as Mdbase;
  const stop = followNativeSignInReturn(mdbase);
  returned({ url: "https://evil.test" });
  expect(mdbase.setForeground).not.toHaveBeenCalled();
  returned({
    url:
      TASKNOTES_NATIVE_RETURN_URL + "?code=not-authority&state=not-authority",
  });
  expect(mdbase.setForeground).toHaveBeenCalledExactlyOnceWith(true);
  stop();
  returned({ url: TASKNOTES_NATIVE_RETURN_URL });
  await act(async () => {});
  expect(mdbase.setForeground).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledOnce();
});
it("cold return also wakes the original SDK owner", async () => {
  native.getLaunchUrl.mockResolvedValueOnce({
    url: TASKNOTES_NATIVE_RETURN_URL,
  } as never);
  native.addListener.mockResolvedValueOnce({ remove: async () => {} });
  const mdbase = { setForeground: vi.fn() } as unknown as Mdbase;
  const stop = followNativeSignInReturn(mdbase);
  await act(async () => {});
  expect(mdbase.setForeground).toHaveBeenCalledWith(true);
  stop();
});
