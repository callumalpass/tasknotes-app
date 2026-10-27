import {
  navigationMotion,
  transitionNavigation,
} from "./navigation-transition";

it("describes how each route change moves", () => {
  expect(navigationMotion({ page: "home" }, { page: "views" })).toBe("switch");
  expect(navigationMotion({ page: "home" }, { page: "task" })).toBe("forward");
  expect(navigationMotion({ page: "task" }, { page: "task" })).toBe("replace");
  expect(navigationMotion({ page: "task" }, { page: "home" })).toBe("back");
});

it("applies the update immediately without view transitions", () => {
  const update = vi.fn();
  transitionNavigation("forward", update, { traversal: true });
  expect(update).toHaveBeenCalledTimes(1);
  expect(document.documentElement.dataset.navigationMotion).toBeUndefined();
});
