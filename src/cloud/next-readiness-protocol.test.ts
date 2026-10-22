import { isNextInstallationCommand } from "./next-installation-protocol";
const collectionId = "11111111-1111-4111-8111-111111111111";
it.each(["ready", "setup_required"])(
  "accepts only the fixed original collection's %s assessment",
  (state) => {
    expect(
      isNextInstallationCommand({
        kind: "session-assess",
        collectionId,
        state,
      }),
    ).toBe(true);
  },
);
it.each([
  { state: "opening" },
  { state: "blocked" },
  { state: true },
  { collectionId: "not-a-collection" },
  { collectionId: undefined },
  { account: collectionId },
  { authority: {} },
  { retry: true },
])("rejects malformed or enlarged readiness input %#", (patch) => {
  expect(
    isNextInstallationCommand({
      kind: "session-assess",
      collectionId,
      state: "ready",
      ...patch,
    }),
  ).toBe(false);
});
