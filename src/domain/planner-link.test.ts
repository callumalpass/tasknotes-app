import { plannerViewUrl } from "./planner-link";

it("links a saved Base view and collection into TaskNotes Planner", () => {
  const url = new URL(
    plannerViewUrl(
      "TaskNotes/Views/launch.base#launch",
      "collection-1",
      "https://planner.example/app",
    ),
  );
  expect(url.pathname).toBe("/app");
  expect(url.searchParams.get("view")).toBe(
    "TaskNotes/Views/launch.base#launch",
  );
  expect(url.searchParams.get("collection")).toBe("collection-1");
});
