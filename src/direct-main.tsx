import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import "@mdbase-dev/ui/collections.css";
import { connectDirect, pairDirect } from "@tasknotes/direct-sdk/direct";
import { takePairInvitation } from "./app/direct-invitation";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DirectCollectionGate } from "./app/direct-collection-gate";
import { FeedbackRoot } from "./app/feedback-root";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { AppI18nProvider } from "./i18n/app-provider";
import { bindDirectRoute } from "./app/use-workspace-navigation";
import { NextTaskRepository } from "./storage/next-repository";
import "./styles.css";
import "./people.css";
import "./accessibility.css";

async function open(
  server: string,
  token: string,
  signal: AbortSignal,
  disconnected: (reason: unknown, tasks?: string[]) => void,
) {
  const client = await connectDirect({
    server,
    token,
    app: { name: "TaskNotes", version: __APP_VERSION__ },
    signal,
  });
  try {
    signal.throwIfAborted();
    const repository = new NextTaskRepository(
      client,
      client.collection,
      { directServer: server },
      {
        clientOwnership: "borrowed",
      },
    );
    const stop = client.onLink((state, reason) => {
      if (state === "closed" && !signal.aborted)
        disconnected(reason, repository.unconfirmedTaskTitles());
    });
    signal.addEventListener(
      "abort",
      () => {
        stop();
        client.close();
      },
      { once: true },
    );
    if (client.link === "closed") throw client.linkProblem;
    bindDirectRoute(JSON.stringify([server, client.collection]));
    return repository;
  } catch (error) {
    client.close();
    throw error;
  }
}

const root = createRoot(document.getElementById("root")!);
function renderEntry(invitation?: string, invalidEntry = false) {
  root.render(
    <StrictMode>
      <AppI18nProvider>
        <FeedbackRoot>
          <AppErrorBoundary>
            <DirectCollectionGate
              invalidEntry={invalidEntry}
              invitation={invitation}
              open={open}
              pair={pairDirect}
            />
          </AppErrorBoundary>
        </FeedbackRoot>
      </AppI18nProvider>
    </StrictMode>,
  );
}

function launch() {
  if (!import.meta.env.PROD || import.meta.env.MODE !== "self-hosted")
    return renderEntry(undefined, true);
  try {
    const invitation = takePairInvitation();
    // Only routes written by this direct workspace restore on a fragment. A
    // bookmarked or hand-typed route starts from the root instead.
    if (
      location.href !== location.origin + "/" &&
      !(
        location.href.startsWith(location.origin + "/#/") &&
        history.state?.directScope
      )
    )
      history.replaceState(null, "", "/");
    renderEntry(invitation);
  } catch {
    renderEntry(undefined, true);
  }
}
launch();
