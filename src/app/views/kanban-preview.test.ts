import { expect, it, vi } from "vitest";
import { kanbanPreviewContent } from "./kanban-preview";

it("preserves the source border-box width and container classes without live controls", () => {
  const card = document.createElement("div");
  card.className = "kanban-card is-movable is-pending is-drop-before";
  card.dataset.kanbanCardId = "one";
  card.innerHTML =
    '<div class="task-row-content"><button id="task-one" aria-label="Open task" tabindex="0">Scheduled Today · Due Tomorrow</button></div>';
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 287.5, 124),
  );
  const preview = kanbanPreviewContent(card);
  expect(preview.style.width).toBe("287.5px");
  expect(preview.style.boxSizing).toBe("border-box");
  expect(preview.className).toBe("kanban-card");
  expect(preview.querySelector(".task-row-content")).toHaveTextContent(
    "Scheduled Today · Due Tomorrow",
  );
  expect(preview.inert).toBe(true);
  expect(preview.querySelector("[id], [aria-label], [tabindex]")).toBeNull();
  expect(preview).not.toHaveAttribute("data-kanban-card-id");
  expect(card).toHaveClass("is-movable");
});
