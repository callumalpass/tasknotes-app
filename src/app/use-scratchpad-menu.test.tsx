import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { registerOverlay } from "../components/overlays/overlay-stack";
import { useScratchpadMenu } from "./use-scratchpad-menu";

function MenuFixture() {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useScratchpadMenu(open, menu, trigger, () => setOpen(false));
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(!open)}>
        Actions
      </button>
      {open ? (
        <div role="menu" ref={menu}>
          <button role="menuitem">Keep as note</button>
        </div>
      ) : null}
      <button>Other panel</button>
    </>
  );
}

it("dismisses on Escape and returns focus to the trigger", async () => {
  render(<MenuFixture />);
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  expect(screen.getByRole("menuitem")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus(),
  );
});

it.each(["resize", "scroll"])(
  "retires an invalidated anchor on %s",
  (event) => {
    render(<MenuFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    act(() => {
      window.dispatchEvent(new Event(event));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  },
);

it("dismisses on outside interaction and when another overlay opens", () => {
  render(<MenuFixture />);
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Other panel" }));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  const root = document.createElement("div");
  document.body.append(root);
  let release: (restoreFocus?: boolean) => void = () => {};
  act(() => {
    release = registerOverlay({ root, modal: false, dismiss: () => {} });
  });
  expect(screen.queryByRole("menu")).toBeNull();
  act(() => release(false));
  root.remove();
});
