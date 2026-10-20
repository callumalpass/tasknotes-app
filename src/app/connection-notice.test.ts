import { expect, it } from "vitest";
import { connectionNotice } from "./connection-notice";

const ready = { phase: { kind: "ready" } } as const;
const sync = (health: string | null, live: boolean | null = true) =>
  ({ kind: "synced", health, live }) as never;

it("never reads as connected while offline, reconnecting or holding changes", () => {
  expect(connectionNotice({ ...ready, sync: sync(null) } as never)).toBeNull();
  expect(connectionNotice({ ...ready, sync: sync(null) } as never, false)).toBe(
    "offline",
  );
  expect(connectionNotice({ ...ready, sync: sync("offline") } as never)).toBe(
    "offline",
  );
  expect(
    connectionNotice({ ...ready, sync: sync("unreachable") } as never),
  ).toBe("reconnecting");
  expect(connectionNotice({ ...ready, sync: sync(null, false) } as never)).toBe(
    "reconnecting",
  );
  expect(
    connectionNotice({
      ...ready,
      sync: sync("offline"),
      writes: { saveState: "saved_on_device" },
    } as never),
  ).toBe("saved_on_device");
  expect(
    connectionNotice({ phase: { kind: "opening" }, live: false } as never),
  ).toBeNull();
});
