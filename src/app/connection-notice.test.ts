import { expect, it } from "vitest";
import { connectionNotice } from "./connection-notice";

const ready = { phase: { kind: "ready" } } as const;
const sync = (
  health: string | null,
  live: boolean | null = true,
  connection = "online",
) => ({ connection, health, live }) as never;

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
    connectionNotice({ ...ready, sync: sync(null, true, "offline") } as never),
  ).toBe("reconnecting");
  // A replica that is still connecting, or a link that is not open, is not a
  // service that cannot be reached.
  expect(
    connectionNotice({
      ...ready,
      sync: sync(null, true, "reconnecting"),
    } as never),
  ).toBeNull();
  expect(
    connectionNotice({
      ...ready,
      sync: {
        ...(sync("offline") as object),
        writes: { saveState: "saved_on_device" },
      },
    } as never),
  ).toBe("saved_on_device");
  expect(
    connectionNotice({ phase: { kind: "opening" }, live: false } as never),
  ).toBeNull();
});
