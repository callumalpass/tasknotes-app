import { render } from "@testing-library/react";
import { useRef } from "react";

import { useFlipMotion } from "./use-flip-motion";

// jsdom has no layout, so each item reports a row position from its index.
function List({ ids, width = 400 }: { ids: string[]; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlipMotion(ref, "data-item");
  return (
    <div ref={ref} data-width={width}>
      {ids.map((id) => (
        <div data-item={id} key={id} />
      ))}
    </div>
  );
}

let animate: ReturnType<typeof vi.fn>;
let reducedMotion = false;

beforeEach(() => {
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  reducedMotion = false;
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = this.parentElement
        ? [...this.parentElement.children].indexOf(this)
        : 0;
      const top = this.dataset.item === undefined ? 0 : index * 40;
      return new DOMRect(0, top, 400, 40);
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
});

it("does not animate the first render", () => {
  render(<List ids={["a", "b", "c"]} />);
  expect(animate).not.toHaveBeenCalled();
});

it("glides items whose position changed when the order changes", () => {
  const { rerender } = render(<List ids={["a", "b", "c"]} />);
  rerender(<List ids={["c", "a", "b"]} />);
  // c moved up two rows; a and b each moved down one row.
  expect(animate).toHaveBeenCalledTimes(3);
  const offsets = animate.mock.calls.map(
    ([keyframes]) => (keyframes as Keyframe[])[0].transform,
  );
  expect(offsets).toEqual([
    "translate(0px, 80px)",
    "translate(0px, -40px)",
    "translate(0px, -40px)",
  ]);
});

it("closes the gap when an item leaves without animating unmoved items", () => {
  const { rerender } = render(<List ids={["a", "b", "c"]} />);
  rerender(<List ids={["a", "c"]} />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect((animate.mock.calls[0][0] as Keyframe[])[0].transform).toBe(
    "translate(0px, 40px)",
  );
});

it("ignores re-renders that keep the same order", () => {
  const { rerender } = render(<List ids={["a", "b"]} />);
  rerender(<List ids={["a", "b"]} width={300} />);
  expect(animate).not.toHaveBeenCalled();
});

it("respects reduced motion", () => {
  reducedMotion = true;
  const { rerender } = render(<List ids={["a", "b", "c"]} />);
  rerender(<List ids={["c", "b", "a"]} />);
  expect(animate).not.toHaveBeenCalled();
});
