import { afterEach, expect, it, vi } from "vitest";
import { runtimeTimezone } from "./runtime-timezone";

afterEach(() => vi.restoreAllMocks());

it("shares the device timezone during a batch and detects travel on the next turn", async () => {
  await Promise.resolve();
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  const options = vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValueOnce({ ...resolved, timeZone: "Australia/Melbourne" })
    .mockReturnValueOnce({ ...resolved, timeZone: "Europe/Paris" });
  expect(runtimeTimezone()).toBe("Australia/Melbourne");
  expect(runtimeTimezone()).toBe("Australia/Melbourne");
  expect(options).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(runtimeTimezone()).toBe("Europe/Paris");
});
