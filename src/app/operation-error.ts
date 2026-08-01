export function cleanOperationError(value: string): string {
  return value.replace(/^[a-z_]+:\s*/i, "");
}
