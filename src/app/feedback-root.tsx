import { Capacitor } from "@capacitor/core";
import {
  FeedbackProvider,
  feedbackApplication,
  resolveFeedbackEndpoint,
  useFeedback,
  type FeedbackApplication,
} from "@mdbase-dev/ui/feedback";
import "@mdbase-dev/ui/feedback.css";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

/** Fixed screen identifiers. Never a view key, task id, title or path. */
export type FeedbackView =
  | "opening"
  | "home"
  | "search"
  | "scratchpad"
  | "views"
  | "task"
  | "more"
  | "failure";

export interface FeedbackConfiguration {
  readonly endpoint: string | null;
  readonly turnstileSiteKey: string | null;
}

const hidden: FeedbackConfiguration = {
  endpoint: null,
  turnstileSiteKey: null,
};

/**
 * The managed feedback Worker and its public Turnstile widget, per environment.
 * An environment appears here only after mdbase-cloud-ops has approved this
 * app's origin for that Worker and widget; anything else keeps every feedback
 * entry hidden.
 */
const managed: Partial<Record<string, FeedbackConfiguration>> = {
  staging: {
    endpoint: "https://feedback-api-staging.mdbase.dev/v1/feedback",
    turnstileSiteKey: "0x4AAAAAAEbkvA4d9vQJq2D1",
  },
  production: {
    endpoint: "https://feedback-api.mdbase.dev/v1/feedback",
    turnstileSiteKey: "0x4AAAAAAEboz_mLT-taI3H-",
  },
};

/**
 * An explicit build endpoint (local and LAB acceptance) wins over the managed
 * one. The iOS shell serves from a `capacitor://` origin the Worker rejects,
 * so feedback stays hidden there.
 */
export function feedbackConfiguration(input: {
  readonly environment: string | undefined;
  readonly endpoint: string | undefined;
  readonly turnstileSiteKey: string | undefined;
  readonly nativeIos: boolean;
}): FeedbackConfiguration {
  if (input.nativeIos) return hidden;
  const explicit = resolveFeedbackEndpoint(input.endpoint);
  if (explicit)
    return {
      endpoint: explicit,
      turnstileSiteKey: input.turnstileSiteKey?.trim() || null,
    };
  return managed[input.environment ?? ""] ?? hidden;
}

const ViewContext = createContext<(view: FeedbackView) => void>(
  () => undefined,
);

/**
 * One provider above the error boundary and the workspace, so a draft
 * survives navigation, collection changes and a render failure.
 */
export function FeedbackRoot({ children }: { readonly children: ReactNode }) {
  const [view, setView] = useState<FeedbackView>("opening");
  const configuration = feedbackConfiguration({
    environment: import.meta.env.VITE_TASKNOTES_ENVIRONMENT,
    endpoint: import.meta.env.VITE_MDBASE_FEEDBACK_URL,
    turnstileSiteKey: import.meta.env.VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY,
    nativeIos:
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios",
  });
  return (
    <ViewContext.Provider value={setView}>
      <FeedbackProvider
        endpoint={configuration.endpoint}
        turnstileSiteKey={configuration.turnstileSiteKey}
        application={feedbackApplication(
          // The published UI types predate mdbase-connect #1348, which adds
          // this product. Drop the cast at the next shared UI repin.
          "tasknotes" as FeedbackApplication["product"],
          view,
          __APP_BUILD_REVISION__,
          import.meta.env.VITE_TASKNOTES_ENVIRONMENT ??
            (import.meta.env.DEV ? "development" : "production"),
        )}
      >
        {children}
      </FeedbackProvider>
    </ViewContext.Provider>
  );
}

/** Names the current screen for a report; resets when that screen leaves. */
export function useFeedbackView(view: FeedbackView): void {
  const setView = useContext(ViewContext);
  useLayoutEffect(() => {
    setView(view);
    return () => setView("opening");
  }, [view, setView]);
}

/**
 * Records one user-visible failure for the optional diagnostics attachment
 * and nudges the feedback icon. Only a bounded code is kept, never the error.
 */
export function ReportFailure({
  code,
  view = "failure",
}: {
  readonly code: "unknown_error" | "source_open_failed";
  readonly view?: FeedbackView;
}) {
  const { reportError } = useFeedback();
  useFeedbackView(view);
  useEffect(() => {
    reportError({ code });
  }, [code, reportError]);
  return null;
}
