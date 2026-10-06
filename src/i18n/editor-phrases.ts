import { t } from "@lingui/core/macro";

/** CodeMirror lookup keys are fixed API data; only their display values are translated. */
export function editorPhrases(): Record<string, string> {
  const line = "$";
  const count = "$";
  return {
    "Control character": t`Control character`,
    "Selection deleted": t`Selection deleted`,
    Completions: t`Completions`,
    "Folded lines": t`Folded lines`,
    "Unfolded lines": t`Unfolded lines`,
    "Fold line": t`Fold line`,
    "Unfold line": t`Unfold line`,
    "folded code": t`folded code`,
    unfold: t`unfold`,
    to: t`to`,
    "Go to line": t`Go to line`,
    go: t`go`,
    Find: t`Find`,
    Replace: t`Replace`,
    next: t`next`,
    previous: t`previous`,
    all: t`all`,
    "match case": t`match case`,
    regexp: t`regexp`,
    "by word": t`by word`,
    replace: t`replace`,
    "replace all": t`replace all`,
    close: t`close`,
    "current match": t`current match`,
    "on line": t`on line`,
    // CodeMirror substitutes the literal dollar token AFTER Lingui formats the message.
    "replaced match on line $": t({
      message: `replaced match on line ${line}`,
      comment:
        "CodeMirror replaces the supplied token with a line number. Keep the line argument.",
    }),
    "replaced $ matches": t({
      message: `replaced ${count} matches`,
      comment:
        "CodeMirror replaces the supplied token with the match count. Keep the count argument.",
    }),
  };
}
