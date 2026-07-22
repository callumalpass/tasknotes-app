export type NativeRoute =
  | { page: "today" | "upcoming" | "search" | "archive" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string };

export type NativeBackAction = "back" | "home" | "exit";

export function nativeBackAction(
  route: NativeRoute,
  primaryViewKey?: string,
): NativeBackAction {
  if (route.page === "task") return "back";
  if (route.page === "views" && route.key && route.key !== primaryViewKey)
    return "back";
  if (route.page === "today") return "exit";
  return "home";
}
