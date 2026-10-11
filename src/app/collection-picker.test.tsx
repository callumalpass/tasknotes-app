import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { COLLECTION_UNAVAILABLE_REASONS } from "@mdbase-dev/sdk";
import { describeError } from "@mdbase-dev/sdk/describe";
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

test.each(COLLECTION_UNAVAILABLE_REASONS)(
  "unavailable %s stays named with SDK copy and never selects or dismisses",
  (reason) => {
    const unavailable: CollectionChoice = {
      collectionId: "private-unavailable",
      displayName: "Private writing",
      availability: { state: "unavailable", reason },
    };
    const copy = describeError(unavailable)!;
    const { calls } = mount({ connections: [unavailable, ...choices] });
    const row = screen.getByRole("button", { name: /Private writing/ });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent(copy.title);
    expect(row).toHaveTextContent(copy.message);
    if (copy.actionLabel) expect(row).toHaveTextContent(copy.actionLabel);
    expect(row).toHaveTextContent("Not available");
    expect(row).not.toHaveTextContent(reason);
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(calls.select).not.toHaveBeenCalled();
    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: /^Work\s*Connected computer\s*Current$/,
      }),
    ).toHaveFocus();
  },
);

test("all unavailable choices keep Cancel reachable with no selection callback", async () => {
  const connections: CollectionChoice[] = COLLECTION_UNAVAILABLE_REASONS.map(
    (reason) => ({
      collectionId: reason,
      displayName: `Private ${reason}`,
      availability: { state: "unavailable", reason },
    }),
  );
  const { calls, trigger } = mount({
    connections,
    selectedCollectionId: null,
    onSelect: undefined,
  });
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toHaveFocus();
  const rows = screen.getAllByRole("button", { name: /^Private / });
  expect(rows).toHaveLength(COLLECTION_UNAVAILABLE_REASONS.length);
  for (const row of rows) {
    expect(row).toBeDisabled();
    expect(() => fireEvent.click(row)).not.toThrow();
  }
  fireEvent.keyDown(document, { key: "Escape" });
  expect(calls.close).toHaveBeenCalledTimes(1);
  expect(calls.select).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("opening availability is not ready and cannot invoke selection", () => {
  const opening: CollectionChoice = {
    collectionId: "opening",
    displayName: "Opening private",
    availability: { state: "opening" },
  };
  const { calls } = mount({ connections: [opening, ...choices] });
  const row = screen.getByRole("button", { name: /Opening private/ });
  expect(row).toBeDisabled();
  expect(row).toHaveTextContent("Opening…");
  fireEvent.click(row);
  expect(calls.select).not.toHaveBeenCalled();
});

test("unavailable current row cannot close the picker and initial focus skips it", () => {
  const current: CollectionChoice = {
    ...choices[1]!,
    availability: { state: "unavailable", reason: "device_offline" },
  };
  const { calls } = mount({ connections: [current, choices[0]!] });
  const row = screen.getByRole("button", { name: /Work/ });
  expect(row).toBeDisabled();
  expect(row).toHaveAttribute("aria-current", "true");
  expect(
    screen.getByRole("button", {
      name: /^Personal\s*Hosted by mdbase\s*Open$/,
    }),
  ).toHaveFocus();
  fireEvent.click(row);
  expect(calls.close).not.toHaveBeenCalled();
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
