import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CollectionPicker } from "./collection-picker";

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
    expect(
      screen.getByRole("button", { name: "Close collection picker" }),
    ).toHaveFocus(),
  );

  const buttons = screen.getByRole("dialog").querySelectorAll("button");
  buttons.item(buttons.length - 1).focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(
    screen.getByRole("button", { name: "Close collection picker" }),
  ).toHaveFocus();

  rendered.unmount();
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
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
