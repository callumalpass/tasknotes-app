import { fireEvent, render, screen } from "@testing-library/react";

import { CollectionPicker } from "./collection-picker";

const connections = [
  {
    collectionId: "hosted",
    displayName: "Hosted tasks",
    operations: [],
    scope: { contracts: [], access: "full_collection" as const },
    route: "remote" as const,
    directAccess: "disabled" as const,
  },
  {
    collectionId: "computer",
    displayName: "Studio computer",
    operations: [],
    scope: { contracts: [], access: "full_collection" as const },
    route: "relay" as const,
    directAccess: "unavailable" as const,
  },
];

it("presents browser, folder, and mdbase collections in one picker", () => {
  const selectLocal = vi.fn();
  const selectCloud = vi.fn();
  const move = vi.fn();

  renderPicker({
    cloudConnections: connections,
    rememberedExternal: {
      mode: "external",
      id: "folder-work",
      name: "Work vault",
    },
    onMoveToMdbase: move,
    onSelectCloud: selectCloud,
    onSelectLocal: selectLocal,
  });

  expect(screen.getByRole("heading", { name: "Collections" })).toBeVisible();
  expect(screen.getByText("TaskNotes folder")).toBeVisible();
  expect(screen.getByText("Work vault")).toBeVisible();
  expect(screen.getByText("Hosted tasks").parentElement).toHaveTextContent(
    "Hosted by mdbase",
  );
  expect(screen.getByText("Studio computer").parentElement).toHaveTextContent(
    "Connected computer",
  );
  expect(
    screen.getByRole("button", { name: /TaskNotes folder/ }),
  ).toHaveAttribute("aria-current", "true");

  fireEvent.click(screen.getByRole("button", { name: /Work vault/ }));
  expect(selectLocal).toHaveBeenCalledWith({
    mode: "external",
    id: "folder-work",
    name: "Work vault",
  });

  fireEvent.click(screen.getByRole("button", { name: /Hosted tasks/ }));
  expect(selectCloud).toHaveBeenCalledWith("hosted");

  fireEvent.click(
    screen.getByRole("button", {
      name: /Move this collection to mdbase/,
    }),
  );
  expect(move).toHaveBeenCalledOnce();
});

it("offers only hosted collections as transfer destinations", () => {
  const selectDestination = vi.fn();
  renderPicker({
    cloudConnections: connections,
    migration: { step: "destination" },
    onSelectMigrationDestination: selectDestination,
  });

  expect(screen.getByRole("heading", { name: "Move to mdbase" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Hosted tasks/ })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Studio computer/ }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Hosted tasks/ }));
  expect(selectDestination).toHaveBeenCalledWith("hosted");
});

it("reports verified transfer totals and retained local backup", () => {
  const finish = vi.fn();
  renderPicker({
    migration: {
      step: "complete",
      destinationName: "Hosted tasks",
      result: {
        records: 12,
        views: 2,
        destinationCollectionId: "hosted",
      },
    },
    onFinishMigration: finish,
  });

  expect(
    screen.getByRole("heading", { name: "Verified in Hosted tasks." }),
  ).toBeVisible();
  expect(screen.getByText(/12 records and 2 saved views copied/)).toBeVisible();
  expect(screen.getByText(/local collection remains available/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Open hosted collection" }),
  );
  expect(finish).toHaveBeenCalledOnce();
});

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof CollectionPicker>> = {},
) {
  const properties: React.ComponentProps<typeof CollectionPicker> = {
    activeChoice: "local",
    activeLocalLocation: { mode: "default" },
    canChooseLocalFolder: true,
    cloudConnections: [],
    migration: null,
    selectedCloudCollectionId: null,
    onAuthorizeCloud: vi.fn(),
    onAuthorizeMigration: vi.fn(),
    onBackFromMigration: vi.fn(),
    onChooseFolder: vi.fn(),
    onClose: vi.fn(),
    onFinishMigration: vi.fn(),
    onMoveToMdbase: vi.fn(),
    onRetryMigration: vi.fn(),
    onSelectCloud: vi.fn(),
    onSelectLocal: vi.fn(),
    onSelectMigrationDestination: vi.fn(),
    ...overrides,
  };
  return render(<CollectionPicker {...properties} />);
}
