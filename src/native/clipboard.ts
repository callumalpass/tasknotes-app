/** Copies text, falling back to a hidden selection where the async Clipboard
 * API is unavailable (older WebViews, insecure origins). */
export async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (reason) {
      if (!copyWithSelection(value)) throw reason;
      return;
    }
  }
  if (!copyWithSelection(value))
    throw new Error("Clipboard access is not available.");
}

function copyWithSelection(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  const previous = document.activeElement as HTMLElement | null;
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
  }
}
