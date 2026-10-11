import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CollectionPicker } from "./collection-picker";
import { registerOverlay } from "../components/overlays/overlay-stack";

const connections = [
  {
    collectionId: "hosted",
    displayName: "Hosted tasks",
    operations: [],
    scope: { contracts: [], access: "full_collection" as const },
    authority: { kind: "hosted" as const, durability: "provider" as const },
    route: "remote" as const,
    directAccess: "disabled" as const,
  },
  {
    collectionId: "computer",
    displayName: "Studio computer",
    operations: [],
    scope: { contracts: [], access: "full_collection" as const },
    authority: { kind: "connector" as const, durability: "computer" as const },
    route: "relay" as const,
    directAccess: "unavailable" as const,
  },
];

it("presents only mdbase collections and their authoritative location", () => {
  const select = vi.fn();
  renderPicker({
    connections,
    selectedCollectionId: "hosted",
    onSelect: select,
  });

  expect(screen.getByText("Hosted tasks").parentElement).toHaveTextContent(
    "Hosted by mdbase",
  );
  expect(screen.getByText("Studio computer").parentElement).toHaveTextContent(
    "Connected computer",
  );
  expect(
    screen.getByRole("heading", { name: "Choose where to work" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Hosted tasks/ }),
  ).toHaveTextContent("Current");
  expect(screen.queryByText("On this device")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Hosted tasks/ })).toHaveAttribute(
    "aria-current",
    "true",
  );

  fireEvent.click(screen.getByRole("button", { name: /Studio computer/ }));
  expect(select).toHaveBeenCalledWith("computer");
});

it("contains focus and restores it when the picker closes", async () => {
  const trigger = document.createElement("button");
  trigger.textContent = "Open collections";
  document.body.append(trigger);
  trigger.focus();

  const rendered = renderPicker({ connections });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Hosted tasks/ })).toHaveFocus(),
  );

  const buttons = screen.getByRole("dialog").querySelectorAll("button");
  buttons.item(buttons.length - 1).focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toHaveFocus();

  rendered.unmount();
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});

it("shares topmost dismissal and isolation with an already open overlay", async () => {
  const parent = document.createElement("section");
  const trigger = document.createElement("button");
  parent.append(trigger);
  document.body.append(parent);
  const dismissParent = vi.fn();
  const release = registerOverlay({
    root: parent,
    modal: true,
    dismiss: dismissParent,
  });
  trigger.focus();
  const close = vi.fn();
  const rendered = renderPicker({ connections, onClose: close });
  try {
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Hosted tasks/ }),
      ).toHaveFocus(),
    );
    expect(parent.inert).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(dismissParent).not.toHaveBeenCalled();
    rendered.unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(parent.inert).toBeFalsy();
    expect(document.body.style.overflow).toBe("hidden");
  } finally {
    rendered.unmount();
    release();
    parent.remove();
  }
});

it("dismissing the current collection does not select or alter the route", () => {
  window.history.replaceState(
    null,
    "",
    "/views/saved?collection=hosted&extra=keep#section",
  );
  const select = vi.fn(),
    close = vi.fn();
  renderPicker({
    connections,
    selectedCollectionId: "hosted",
    onSelect: select,
    onClose: close,
  });
  fireEvent.click(screen.getByRole("button", { name: /Hosted tasks/ }));
  expect(close).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  expect(location.pathname + location.search + location.hash).toBe(
    "/views/saved?collection=hosted&extra=keep#section",
  );
});

it("accepts provider-neutral collection metadata without guessing an authority", () => {
  renderPicker({
    connections: [{ collectionId: "plain", displayName: "Unnamed authority" }],
  });
  expect(
    screen.getByRole("button", { name: /Unnamed authority/ }),
  ).toBeVisible();
  expect(screen.queryByText("Hosted by mdbase")).not.toBeInTheDocument();
  expect(screen.queryByText("Connected computer")).not.toBeInTheDocument();
});

it("searches long catalogs by name and distinguishes no matches from no collections", () => {
  const catalog = Array.from({ length: 8 }, (_, index) => ({
    collectionId: String(index),
    displayName: `Collection ${index}`,
  }));
  renderPicker({ connections: catalog });
  const search = screen.getByRole("searchbox", { name: "Search collections" });
  fireEvent.change(search, { target: { value: "collection 7" } });
  expect(screen.getByRole("button", { name: /Collection 7/ })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Collection 0/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "absent" } });
  expect(screen.getByText(/No collections match/)).toBeVisible();
  expect(
    screen.queryByText(/No collections are connected/),
  ).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: /Collection 0/ })).toBeVisible();
});

it("renders controlled progress, failure and Retry without choosing, closing or changing URL optimistically", () => {
  const props = {
    connections,
    selectedCollectionId: "hosted",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onAuthorize: vi.fn(),
    onRetry: vi.fn(),
  };
  const originalUrl = location.href;
  const rendered = render(
    <CollectionPicker {...props} openingCollectionId="computer" />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Opening Studio computer…",
  );
  expect(
    screen.getByRole("button", { name: /Studio computer/ }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /Connect another collection/ }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Studio computer/ }));
  expect(props.onSelect).not.toHaveBeenCalled();
  rendered.rerender(
    <CollectionPicker
      {...props}
      error="This collection could not be opened."
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("could not be opened");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(props.onRetry).toHaveBeenCalledOnce();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(location.href).toBe(originalUrl);
  fireEvent.click(
    screen.getByRole("button", { name: "Close collection picker" }),
  );
  expect(props.onClose).toHaveBeenCalledOnce();
});

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof CollectionPicker>> = {},
) {
  return render(
    <CollectionPicker
      connections={[]}
      selectedCollectionId={null}
      onAuthorize={vi.fn()}
      onClose={vi.fn()}
      onSelect={vi.fn()}
      {...overrides}
    />,
  );
}
