import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

type Observed = Pick<MdbaseSnapshot, "phase" | "selection">;
type Phase = Observed["phase"];
type Approval = NonNullable<Observed["selection"]["lastApproval"]>;

interface Intent {
  /** The collection open behind the Connect window; never armed by it. */
  readonly previous: string | null;
  /** Signing in reports no approval outcome: the collection it opens counts. */
  readonly signIn: boolean;
}

/**
 * Decides which collection gets TaskNotes' starter views. Only a collection the
 * person just approved in this tab (sign in, add, approve) or just finished
 * setting up is armed. Opening, switching or reloading never arms anything, so
 * navigation never writes. The write itself is `onlyIfNoViews` and tolerates a
 * second tab doing the same.
 */
export class StarterViewArming {
  private lastApproval: Approval | null;
  private intent: Intent | null = null;
  private setupFor: string | null = null;
  private openId: string | null = null;
  private armed: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Observed) {
    // An outcome from before this page started belongs to nobody here.
    this.lastApproval = initial.selection.lastApproval ?? null;
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
    const approval = snapshot.selection.lastApproval ?? null;
    const settled = approval !== null && approval !== this.lastApproval;
    this.lastApproval = approval;
    const id = collectionOf(phase);

    if (phase.kind === "authorizing") {
      this.intent ??= {
        previous: this.openId,
        signIn: phase.purpose === "sign_in",
      };
    } else if (this.intent) {
      const intent = this.intent;
      if (settled) {
        this.intent = null;
        if (
          approval.collectionId &&
          approval.collectionId !== intent.previous &&
          (approval.outcome === "added" || approval.outcome === "unchanged")
        )
          this.arm(approval.collectionId);
      } else if (!intent.signIn) {
        // approve() ended without an outcome (it failed): nothing was approved.
        this.intent = null;
      } else if (id) {
        this.intent = null;
        if (id !== intent.previous) this.arm(id);
      } else if (phase.kind !== "starting") {
        this.intent = null;
      }
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
