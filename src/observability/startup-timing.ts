const stages = [
  "native_open",
  "bootstrap",
  "sql_open",
  "verified_read",
  "repository_init",
  "first_query",
  "first_render",
] as const;
export type StartupStage = (typeof stages)[number];
export type StartupDurations = Partial<Record<StartupStage, number>>;
let sequence = 0;
const traces = new WeakMap<object, StartupTiming>();

/** Diagnostic only: fixed labels/durations, no account, collection, request,
 * source, error or credential data. Never changes an operation's outcome. */
export class StartupTiming {
  private readonly prefix = `tasknotes:startup:${++sequence}`;
  private readonly pending = new Map<StartupStage, object>();
  private readonly durations: StartupDurations = {};
  private logged = false;
  constructor(seed?: unknown) {
    if (seed && typeof seed === "object" && !Array.isArray(seed)) {
      for (const stage of stages.slice(0, 4)) {
        const value: unknown = Object.getOwnPropertyDescriptor(
          seed,
          stage,
        )?.value;
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 600_000
        )
          this.durations[stage] = value;
      }
    }
  }
  has(stage: StartupStage) {
    return this.durations[stage] !== undefined;
  }
  begin(stage: StartupStage): () => void {
    if (this.has(stage) || this.logged) return () => {};
    const token = {};
    this.pending.set(stage, token);
    const name = `${this.prefix}:${stage}`;
    let start: number;
    try {
      start = performance.now();
      performance.clearMarks?.(`${name}:start`);
      performance.mark(`${name}:start`);
    } catch {
      this.pending.delete(stage);
      return () => {};
    }
    return () => {
      if (this.pending.get(stage) !== token || this.logged) return;
      this.pending.delete(stage);
      try {
        const duration = performance.now() - start;
        if (Number.isFinite(duration) && duration >= 0 && duration <= 600_000)
          this.durations[stage] = Math.round(duration * 10) / 10;
        performance.mark(`${name}:end`);
        performance.measure(name, `${name}:start`, `${name}:end`);
      } catch {
        /* Timing APIs must not affect the original work. */
      }
    };
  }
  snapshot(): StartupDurations {
    return { ...this.durations };
  }
  report() {
    if (this.logged || !this.has("first_query") || !this.has("first_render"))
      return;
    this.logged = true;
    try {
      const mdbase = sdkStartupDurations();
      console.debug(
        "[TaskNotes startup timing ms]",
        JSON.stringify(mdbase ? { ...this.durations, mdbase } : this.durations),
      );
    } catch {
      /* Logging must not affect rendering. */
    }
  }
}
const sdkMeasure = /^mdbase:startup:([a-z_]{1,32}(?::[a-z_]{1,32})?)$/;

/** The SDK's own startup stages, which it records as User Timing measures
 * named `mdbase:startup:<stage>` with fixed labels. Empty before an SDK that
 * records them. */
function sdkStartupDurations(): Record<string, number> | undefined {
  const durations: Record<string, number> = {};
  try {
    for (const entry of performance.getEntriesByType("measure")) {
      const stage = sdkMeasure.exec(entry.name)?.[1];
      if (
        stage === undefined ||
        !Number.isFinite(entry.duration) ||
        entry.duration < 0 ||
        entry.duration > 600_000
      )
        continue;
      // A stage entered twice (a phase revisited) reports its whole time.
      durations[stage] =
        Math.round(((durations[stage] ?? 0) + entry.duration) * 10) / 10;
    }
  } catch {
    return undefined;
  }
  return Object.keys(durations).length ? durations : undefined;
}

export function registerStartupTiming(repository: object, seed?: unknown) {
  const trace = new StartupTiming(seed);
  traces.set(repository, trace);
  return trace;
}
export function startupTiming(repository: object) {
  return traces.get(repository);
}
export async function timedStartup<T>(
  repository: object,
  stage: StartupStage,
  operation: () => Promise<T>,
): Promise<T> {
  const end = startupTiming(repository)?.begin(stage);
  try {
    return await operation();
  } finally {
    end?.();
  }
}
