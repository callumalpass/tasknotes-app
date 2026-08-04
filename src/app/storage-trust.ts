export function storageExplanation(): string {
  return "The mdbase collection is the source of truth. TaskNotes reads and writes it directly; changes require a connection.";
}
