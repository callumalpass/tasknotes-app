import { t } from "@lingui/core/macro";
import { todayString } from "../domain/task";

export function compactAgendaDays(
  root: HTMLElement,
  selected: string,
  locale: string,
) {
  const sections = [
    ...root.querySelectorAll<HTMLElement>(".tnc-list-section[data-date]"),
  ];
  let emptyRun: HTMLElement[] = [];
  const flush = () => {
    if (!emptyRun.length) return;
    const first = emptyRun[0]!;
    const last = emptyRun.at(-1)!;
    const format = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    });
    const range = format.formatRange(
      new Date(`${first.dataset.date}T12:00:00`),
      new Date(`${last.dataset.date}T12:00:00`),
    );
    first.classList.add("is-empty-range");
    let label = first.querySelector<HTMLElement>(".agenda-empty-range");
    if (!label) {
      label = document.createElement("div");
      label.className = "agenda-empty-range";
      first.append(label);
    }
    const text = t`No tasks · ${range}`;
    if (label.textContent !== text) label.textContent = text;
    first.setAttribute("aria-label", text);
    for (const section of emptyRun.slice(1)) section.hidden = true;
    emptyRun = [];
  };
  for (const section of sections) {
    section.hidden = false;
    section.classList.remove("is-empty-range");
    const date = section.dataset.date;
    section.classList.toggle(
      "is-add-day",
      date === selected || date === todayString(),
    );
    if (
      section.classList.contains("is-empty") &&
      date !== selected &&
      date !== todayString()
    ) {
      emptyRun.push(section);
    } else {
      flush();
      section.querySelector(".agenda-empty-range")?.remove();
      const label = section.querySelector(".tnc-list-day")?.textContent;
      if (label) section.setAttribute("aria-label", label);
    }
  }
  flush();
}
