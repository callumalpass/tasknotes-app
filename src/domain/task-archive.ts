export function archiveMoveWarning(reason: unknown, archived: boolean): string {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return `archive_move_failed: The task was ${archived ? "archived" : "restored"}, but its Markdown record could not be moved. ${detail}`;
}
