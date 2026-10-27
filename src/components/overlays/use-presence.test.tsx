import { act, render, renderHook, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useExitingValue, usePresence } from "./use-presence";

function Overlay({ open, onExited }: { open: boolean; onExited?(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = usePresence(open, ref, onExited);
  if (!present) return null;
  return (
    <div
      data-state={open ? "open" : "closed"}
      data-testid="overlay"
      inert={!open}
      ref={ref}
    />
  );
}

function stubExitAnimation() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const animation = {
    playState: "running",
    finished,
    effect: { getComputedTiming: () => ({ endTime: 140 }) },
  };
  Element.prototype.getAnimations = vi.fn(() => [
    animation as unknown as Animation,
  ]);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  return finish;
}

afterEach(() => {
  delete (Element.prototype as Partial<Element>).getAnimations;
  vi.unstubAllGlobals();
});

it("unmounts at once where exit motion is unavailable", () => {
  const onExited = vi.fn();
  const { rerender } = render(<Overlay open onExited={onExited} />);
  rerender(<Overlay open={false} onExited={onExited} />);
  expect(screen.queryByTestId("overlay")).toBeNull();
  expect(onExited).toHaveBeenCalledTimes(1);
});

it("keeps a closed overlay inert and mounted until its exit finishes", async () => {
  const finish = stubExitAnimation();
  const onExited = vi.fn();
  const { rerender } = render(<Overlay open onExited={onExited} />);
  rerender(<Overlay open={false} onExited={onExited} />);
  const overlay = screen.getByTestId("overlay");
  expect(overlay.dataset.state).toBe("closed");
  expect(overlay.hasAttribute("inert")).toBe(true);
  expect(onExited).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(screen.queryByTestId("overlay")).toBeNull();
  expect(onExited).toHaveBeenCalledTimes(1);
});

it("reopens an exiting overlay without unmounting it", async () => {
  const finish = stubExitAnimation();
  const { rerender } = render(<Overlay open />);
  const overlay = screen.getByTestId("overlay");
  rerender(<Overlay open={false} />);
  rerender(<Overlay open />);
  await act(async () => finish());
  expect(screen.getByTestId("overlay")).toBe(overlay);
  expect(overlay.dataset.state).toBe("open");
  expect(overlay.hasAttribute("inert")).toBe(false);
});

it("respects reduced motion", () => {
  stubExitAnimation();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { rerender } = render(<Overlay open />);
  rerender(<Overlay open={false} />);
  expect(screen.queryByTestId("overlay")).toBeNull();
});

it("retains the last value while exiting and keys each new opening", () => {
  const { result } = renderHook(() => {
    const [value, setValue] = useState<string | null>("first");
    return { exiting: useExitingValue(value), setValue };
  });
  const firstKey = result.current.exiting.key;
  act(() => result.current.setValue(null));
  expect(result.current.exiting.value).toBe("first");
  act(() => result.current.setValue("second"));
  expect(result.current.exiting.value).toBe("second");
  expect(result.current.exiting.key).not.toBe(firstKey);
  act(() => result.current.setValue(null));
  act(() => result.current.exiting.clear());
  expect(result.current.exiting.value).toBeNull();
});
