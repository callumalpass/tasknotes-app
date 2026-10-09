/**
 * Where TaskNotes reconciles its opaque reminder timers.
 *
 * Today the timers live at the collection authority, reached through the
 * Connect connection (`connection.reconcileTimers`). In mdbase-next they live
 * in the control plane's timer service in every collection state, reached with
 * the SDK's `TimersApi`, which needs no replica to be online. Both take the
 * same input: an opaque ID and a UTC instant per reminder, with no content.
 */
export interface ReminderTimerInput {
  namespace: string;
  criterionId: string;
  timers: Array<{ id: string; fireAt: string }>;
}

export interface ReminderTimerRequest {
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ReminderTimerAuthority {
  reconcile(
    input: ReminderTimerInput,
    request: ReminderTimerRequest,
  ): Promise<void>;
}

/** The subset of `@mdbase-dev/sdk` `TimersApi` TaskNotes uses. */
export interface OpaqueTimerService {
  reconcile(
    input: ReminderTimerInput,
    options: { signal?: AbortSignal },
  ): Promise<{ namespace: string; cancelledIds: string[] }>;
}

/** Reconcile through the mdbase-next timer service, with the request's budget. */
export function opaqueTimerAuthority(
  service: OpaqueTimerService,
): ReminderTimerAuthority {
  return {
    async reconcile(input, request) {
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(request.timeoutMs),
      ]);
      await service.reconcile(input, { signal });
    },
  };
}
