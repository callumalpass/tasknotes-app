export function kanbanPreviewContent(card: HTMLElement): HTMLElement {
  const copy = card.cloneNode(true) as HTMLElement;
  copy.style.width = `${card.getBoundingClientRect().width}px`;
  copy.style.boxSizing = "border-box";
  copy.classList.remove("is-dragging", "is-pending", "is-movable");
  for (const name of [...copy.classList])
    if (name.startsWith("is-drop-")) copy.classList.remove(name);
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const { name } of [...element.attributes])
      if (
        name === "id" ||
        name === "role" ||
        name === "tabindex" ||
        name === "for" ||
        name.startsWith("aria-") ||
        name.startsWith("data-")
      )
        element.removeAttribute(name);
  }
  copy.inert = true;
  return copy;
}
