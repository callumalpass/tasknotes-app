type ReloadParticipant = {
  save?(): Promise<unknown>;
  check?(): Promise<unknown> | void;
};
const participants = new Set<ReloadParticipant>();

/** App-owned editors expose their existing save paths; no draft is discarded. */
export function registerReloadParticipant(
  participant: ReloadParticipant,
): () => void {
  participants.add(participant);
  return () => {
    participants.delete(participant);
  };
}

export async function saveBeforeReload(): Promise<void> {
  for (const participant of [...participants]) await participant.save?.();
  // Check the current editors again: typing or navigation may have happened during save.
  for (const participant of [...participants]) await participant.check?.();
}
