import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

type Observed = Pick<MdbaseSnapshot, "phase" | "selection">;
type Phase = Observed["phase"];
type Approval = NonNullable<Observed["selection"]["lastApproval"]>;

/**
 * Decides which collection gets TaskNotes' starter views. Only a collection the
 * person just approved in this tab or just finished setting up is armed. The
 * SDK's approval outcome is the signal, whichever UI started the approval (the
 * gate, the shared switcher or a direct SDK call). Each outcome is handled once:
 * opening, switching, re-rendering or reloading never arms anything, so
 * navigation never writes. The write itself is `onlyIfNoViews` and tolerates a
 * second tab doing the same.
 */
export class StarterViewArming {
  /** The last outcome dealt with; the SDK freezes one object per approval. */
  private handled: Approval | null;
  /** The collection open when the Connect window opened; never armed by it.
   * Undefined when this tab never saw the window open. */
  private behind: string | null | undefined;
  private authorizing = false;
  /** Signing in reports no approval outcome: the collection it opens counts. */
  private signingIn = false;
  private setupFor: string | null = null;
  private openId: string | null = null;
  private armed: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Observed) {
    // An outcome from before this page started belongs to nobody here.
    this.handled = initial.selection.lastApproval ?? null;
    this.observe(initial);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getArmed = (): string | null => this.armed;

  /** Follow an mdbase entry's snapshots until the returned stop is called. */
  follow(source: {
    getSnapshot(): Observed;
    subscribe(listener: () => void): () => void;
  }): () => void {
    const stop = source.subscribe(() => this.observe(source.getSnapshot()));
    this.observe(source.getSnapshot());
    return stop;
  }

  /** True once, for the armed collection: the caller writes the starter views. */
  take(collectionId: string): boolean {
    if (this.armed !== collectionId) return false;
    this.armed = null;
    return true;
  }

  observe(snapshot: Observed): void {
    const phase = snapshot.phase;
    const id = collectionOf(phase);

    if (phase.kind === "authorizing") {
      if (!this.authorizing) {
        this.behind = this.openId;
        this.signingIn = phase.purpose === "sign_in";
      }
      this.authorizing = true;
    } else this.authorizing = false;

    const approval = snapshot.selection.lastApproval ?? null;
    if (approval !== null && approval !== this.handled) {
      this.handled = approval;
      this.signingIn = false;
      const behind = this.behind === undefined ? this.openId : this.behind;
      this.behind = undefined;
      const target = approval.collectionId;
      // `added` was not approved before this approval began, so it cannot be
      // the collection open behind the window. Declined or closed arms nothing.
      if (
        target &&
        (approval.outcome === "added" ||
          (approval.outcome === "unchanged" && target !== behind))
      )
        this.arm(target);
    } else if (this.signingIn && !this.authorizing) {
      if (id) {
        this.signingIn = false;
        if (id !== (this.behind ?? null)) this.arm(id);
      } else if (phase.kind !== "starting") this.signingIn = false;
    }

    if (phase.kind === "needs_setup") this.setupFor = phase.collectionId;
    else if (phase.kind === "ready" && this.setupFor === phase.collectionId) {
      this.setupFor = null;
      this.arm(phase.collectionId);
    } else if (id !== this.setupFor) this.setupFor = null;

    if (phase.kind === "ready") this.openId = phase.collectionId;
    else if (
      phase.kind === "choosing" ||
      phase.kind === "signed_out" ||
      phase.kind === "closed"
    )
      this.openId = null;
  }

  private arm(collectionId: string): void {
    if (this.armed === collectionId) return;
    this.armed = collectionId;
    for (const listener of this.listeners) listener();
  }
}

function collectionOf(phase: Phase): string | null {
  switch (phase.kind) {
    case "opening":
    case "needs_setup":
    case "ready":
    case "problem":
      return phase.collectionId;
    default:
      return null;
  }
}
