import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { CollectionPicker, type CollectionChoice } from "./collection-picker";

// Presentation-only callers. No SDK/session/native readiness is fabricated.
const choices: CollectionChoice[] = [
  {
    collectionId: "alpha",
    displayName: "Personal",
    authority: { kind: "hosted" },
  },
  {
    collectionId: "beta",
    displayName: "Work",
    authority: { kind: "connector" },
  },
  { collectionId: "gamma", displayName: "Unknown provider" },
];
function mount(options: Partial<ComponentProps<typeof CollectionPicker>> = {}) {
  const calls = {
    close: vi.fn(),
    select: vi.fn(),
    authorize: vi.fn(),
    retry: vi.fn(),
  };
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Change collection</button>
        <p>Current workspace remains here</p>
        {open ? (
          <CollectionPicker
            connections={choices}
            selectedCollectionId="beta"
            onSelect={calls.select}
            onAuthorize={calls.authorize}
            onRetry={calls.retry}
            {...options}
            onClose={() => {
              calls.close();
              setOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "Change collection" });
  trigger.focus();
  fireEvent.click(trigger);
  return { calls, trigger };
}

test("focuses the usable collection and marks only that row Current", () => {
  mount();
  const dialog = screen.getByRole("dialog", { name: "Choose where to work" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const current = within(dialog).getByRole("button", {
    // jsdom has no row-grid CSS; retain all name parts across layout whitespace.
    name: /^Work\s*Connected computer\s*Current$/,
  });
  expect(current).toHaveFocus();
  expect(current).toHaveAttribute("aria-current", "true");
  expect(within(dialog).getAllByText("Current")).toHaveLength(1);
  expect(
    within(dialog).getByRole("button", { name: /^Unknown provider\s*Open$/ }),
  ).not.toHaveAttribute("aria-current");
});

test.each(["button", "Escape"])(
  "pre-selection %s dismissal preserves route/workspace and returns focus",
  async (method) => {
    const url = location.href;
    const { calls, trigger } = mount();
    if (method === "button")
      fireEvent.click(
        screen.getByRole("button", { name: "Close collection picker" }),
      );
    else fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.close).toHaveBeenCalledTimes(1);
    expect(calls.select).not.toHaveBeenCalled();
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(calls.retry).not.toHaveBeenCalled();
    expect(location.href).toBe(url);
    expect(
      screen.getByText("Current workspace remains here"),
    ).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).not.toBe("hidden");
  },
);

test("current row dismisses without selection; another row forwards only its opaque ID", () => {
  const { calls } = mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: /^Personal\s*Hosted by mdbase\s*Open$/,
    }),
  );
  expect(calls.select).toHaveBeenCalledExactlyOnceWith("alpha");
  expect(calls.close).not.toHaveBeenCalled();
  expect(calls.authorize).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: /^Work\s*Connected computer\s*Current$/,
    }),
  );
  expect(calls.close).toHaveBeenCalledTimes(1);
  expect(calls.select).toHaveBeenCalledTimes(1);
});

test("search filters approved names without inferring a provider or exposing IDs", () => {
  const connections = [
    ...choices,
    ...["Garden", "Travel", "Archive"].map((displayName, i) => ({
      collectionId: `private-id-${i}`,
      displayName,
    })),
  ];
  mount({ connections, selectedCollectionId: null });
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search collections" }),
    { target: { value: "  tRaVeL  " } },
  );
  expect(
    screen.getByRole("button", { name: /^Travel\s*Open$/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Personal/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/private-id/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "missing" },
  });
  expect(
    screen.getByText("No collections match “missing”."),
  ).toBeInTheDocument();
});

test("approval and retry remain explicit caller actions, never automatic error replay", () => {
  const { calls } = mount({ error: "This collection needs approval." });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This collection needs approval.",
  );
  expect(calls.retry).not.toHaveBeenCalled();
  expect(calls.authorize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(calls.retry).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: /Connect another collection/ }),
  );
  expect(calls.authorize).toHaveBeenCalledTimes(1);
  expect(calls.select).not.toHaveBeenCalled();
});

test("in-flight opening disables duplicate actions and does not imply Cancel can roll it back", () => {
  const { calls } = mount({
    openingCollectionId: "alpha",
    error: "Earlier problem",
  });
  expect(screen.getByRole("status")).toHaveTextContent("Opening Personal…");
  expect(screen.getByRole("dialog")).toHaveFocus();
  for (const button of within(screen.getByRole("dialog")).getAllByRole(
    "button",
  ))
    expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Close collection picker" }),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
});

test("empty choices keep dismissal reachable and do not invent a current collection", () => {
  mount({ connections: [], selectedCollectionId: null });
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toHaveFocus();
  expect(screen.queryByText("Current")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "No collections are connected to TaskNotes on this device yet.",
    ),
  ).toBeInTheDocument();
});
