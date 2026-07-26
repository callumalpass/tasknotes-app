import { fireEvent, render, screen } from "@testing-library/react";

const connect = vi.hoisted(() => ({
  authorize: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock("../cloud/connect", () => ({
  activeCloudConnection: vi.fn(() => null),
  authorizeCloudCollection: connect.authorize,
  cleanCallbackUrl: vi.fn(),
  completeCloudAuthorization: vi.fn(),
  isCloudCallback: vi.fn(() => false),
  onCloudConnectionChange: vi.fn(() => vi.fn()),
  savedCloudConnections: vi.fn(() => [
    {
      collectionId: "collection-offline",
      displayName: "Home tasks",
      operations: [],
      scope: { contracts: [], access: "full_collection" },
      route: "relay",
      directAccess: "unavailable",
    },
    {
      collectionId: "collection-online",
      displayName: "Work tasks",
      operations: [],
      scope: { contracts: [], access: "full_collection" },
      route: "hosted",
      directAccess: "disabled",
    },
  ]),
  selectedCloudCollectionId: vi.fn(() => "collection-offline"),
  selectCloudConnection: vi.fn(),
}));

import { CloudConnection } from "./cloud-collection";

it("lists every remembered collection and connects another without pinning the offline one", () => {
  render(<CloudConnection error={null} onBack={vi.fn()} />);

  expect(screen.getByRole("button", { name: "Open Home tasks" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Work tasks" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Reconnect Home tasks" }),
  ).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Connect another collection" }),
  );

  expect(connect.authorize).toHaveBeenCalledWith(undefined);
});
