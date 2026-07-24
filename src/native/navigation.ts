export type NativeRoute =
  | { page: "home" | "search" | "more" }
  | { page: "views"; key?: string }
  | { page: "task"; id: string };

export type NativeBackAction = "back" | "home" | "exit";

export function nativeBackAction(
  route: NativeRoute,
  navigationViewKeys: readonly string[] = [],
): NativeBackAction {
  if (route.page === "task") return "back";
  if (
    route.page === "views" &&
    route.key &&
    !navigationViewKeys.includes(route.key)
  )
    return "back";
  if (route.page === "home") return "exit";
  return "home";
}
