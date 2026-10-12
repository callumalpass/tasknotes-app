import { expect, it } from "vitest";
import type { MdbaseSnapshot } from "@mdbase-dev/sdk";
import { StarterViewArming } from "./starter-view-arming";

type Observed = Pick<MdbaseSnapshot, "phase" | "selection">;
type Approval = NonNullable<Observed["selection"]["lastApproval"]>;

function snap(
  phase: Record<string, unknown>,
  lastApproval: Approval | null = null,
): Observed {
  return { phase, selection: { lastApproval } } as unknown as Observed;
}
const ready = (id: string) => snap({ kind: "ready", collectionId: id });
const opening = (id: string) => snap({ kind: "opening", collectionId: id });
const authorizing = (purpose: string) => snap({ kind: "authorizing", purpose });
const approval = (
  collectionId: string,
  outcome: Approval["outcome"] = "added",
): Approval => ({ kind: "add", outcome, collectionId });

it("arms the collection an approval opened, never the one open behind it", () => {
  const arming = new StarterViewArming(ready("a"));
  arming.observe(authorizing("add"));
  const added = approval("b");
  arming.observe(snap({ kind: "opening", collectionId: "b" }, added));
  expect(arming.take("a")).toBe(false);
  arming.observe(snap({ kind: "ready", collectionId: "b" }, added));
  expect(arming.take("b")).toBe(true);
  // Once only.
  expect(arming.take("b")).toBe(false);

  arming.observe(authorizing("approve"));
  arming.observe(
    snap({ kind: "ready", collectionId: "b" }, approval("b", "unchanged")),
  );
  expect(arming.getArmed()).toBeNull();
});

it("never arms on navigation, a reload or a declined approval", () => {
  // A stale outcome from before this page belongs to nobody.
  const arming = new StarterViewArming(
    snap({ kind: "starting" }, approval("old")),
  );
  for (const next of [
    opening("c"),
    ready("c"),
    snap({ kind: "choosing" }),
    opening("d"),
    ready("d"),
  ])
    arming.observe(next);
  expect(arming.getArmed()).toBeNull();

  arming.observe(authorizing("add"));
  arming.observe(snap({ kind: "choosing" }, approval("e", "declined")));
  arming.observe(ready("e"));
  expect(arming.getArmed()).toBeNull();
});

it("arms after the person signs in or finishes setup in this tab", () => {
  const signIn = new StarterViewArming(snap({ kind: "signed_out" }));
  signIn.observe(authorizing("sign_in"));
  signIn.observe(snap({ kind: "starting" }));
  signIn.observe(opening("f"));
  expect(signIn.take("f")).toBe(true);

  const setup = new StarterViewArming(
    snap({ kind: "needs_setup", collectionId: "g" }),
  );
  setup.observe(opening("g"));
  setup.observe(ready("g"));
  expect(setup.take("g")).toBe(true);

  // Leaving a collection that needed setup forgets it.
  const left = new StarterViewArming(
    snap({ kind: "needs_setup", collectionId: "h" }),
  );
  left.observe(opening("i"));
  left.observe(ready("i"));
  left.observe(ready("h"));
  expect(left.getArmed()).toBeNull();
});
