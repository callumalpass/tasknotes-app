import { act, renderHook, waitFor } from "@testing-library/react";
import { useKeyboardOcclusion } from "./use-keyboard-occlusion";

afterEach(() => {
  vi.unstubAllGlobals();
});
it("retains navigation for hardware focus and hides it only for observed keyboard occlusion", async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const input = document.createElement("textarea");
  document.body.append(input);
  const { result, unmount } = renderHook(() => useKeyboardOcclusion());
  act(() => input.focus());
  expect(result.current).toBe(false);
  act(() => {
    viewport.height -= 300;
    viewport.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(result.current).toBe(true));
  act(() => {
    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(result.current).toBe(false));
  act(() => {
    viewport.scale = 1;
    viewport.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(result.current).toBe(true));
  act(() => input.blur());
  await waitFor(() => expect(result.current).toBe(false));
  unmount();
  input.remove();
});
