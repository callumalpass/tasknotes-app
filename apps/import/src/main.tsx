import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { createRoot } from "react-dom/client";
import App, { loadTodoist, type InitialState } from "./App";
import { completeTodoist } from "./oauth";
import "./styles.css";
import { applyThemePreference, loadThemePreference } from "./theme";

applyThemePreference(loadThemePreference());
const root = createRoot(document.getElementById("root")!);
async function start() {
  const initial: InitialState = {};
  const callback = location.href;
  try {
    if (location.pathname === "/auth/todoist/callback") {
      root.render(
        <main>
          <p role="status">Reading your Todoist tasks…</p>
        </main>,
      );
      initial.source = await loadTodoist(await completeTodoist());
    } else if (location.pathname === "/auth/mdbase/callback") {
      root.render(
        <main>
          <p role="status">Completing your collection connection…</p>
        </main>,
      );
      // The SDK's Private-collection popup returns to this static route.
      // Do not start a second application session in the callback window.
      (await import("@mdbase-dev/sdk/app-grant")).deliverAppGrantCallback(
        callback,
      );
      window.close();
      return;
    }
  } catch (e) {
    initial.error =
      e instanceof Error
        ? e.message
        : "Could not finish connecting. Please start again.";
  }
  root.render(<App initial={initial} />);
}
void start();
