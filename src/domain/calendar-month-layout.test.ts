import { expect, it } from "vitest";
import {
  ItemStore,
  getTimeZone,
  layoutRow,
  parseDay,
} from "@tasknotes/calendar/core";

it("packs dense same-day items in order and reuses the first free row across hidden days", () => {
  const store = new ItemStore(getTimeZone("UTC"));
  const day = (date: number) => `2026-11-${String(date).padStart(2, "0")}`;
  const item = (id: string, start: number, end: number) => ({
    id,
    title: id,
    allDay: true,
    start: day(start),
    end: day(end),
  });
  const short = Array.from({ length: 300 }, (_, i) =>
    item(String(i).padStart(3, "0"), 2, 3),
  );
  store.setAll([
    item("spans week start", 1, 5),
    ...short,
    item("after short", 4, 6),
    item("after span", 5, 7),
  ]);
  const days = [2, 4, 5, 6].map((date) => parseDay(day(date))!);
  const { placements, countByCol, levels } = layoutRow([...store.all()], days);
  expect(placements.map((p) => [p.item.id, p.level])).toEqual([
    ["spans week start", 0],
    ...short.map(({ id }, i) => [id, i + 1]),
    ["after short", 1],
    ["after span", 0],
  ]);
  expect(countByCol).toEqual([301, 2, 2, 1]);
  expect(levels).toBe(301);
});
