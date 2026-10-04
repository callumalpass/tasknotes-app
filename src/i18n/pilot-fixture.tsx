import { Trans } from "@lingui/react/macro";

/** Test-only representative rich text; not mounted in the normal application. */
export function PilotRichText({ name }: { name: string }) {
  return (
    <p>
      <Trans context="translation pilot rich-text example">
        Hello {name}. Read <a href="https://tasknotes.dev">the documentation</a>
        .
      </Trans>
    </p>
  );
}
