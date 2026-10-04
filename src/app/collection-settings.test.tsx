import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { createPilotI18n } from "../i18n/pilot";
import { PilotRichText } from "../i18n/pilot-fixture";
import { CollectionSettingsContent } from "./collection-settings";
import { storageExplanation } from "./storage-trust";

const state = vi.hoisted(() => ({
  scanned: 1,
  refreshing: false,
  refresh: vi.fn(),
  changeCollection: vi.fn(),
}));
vi.mock("./collection-context", () => ({
  useCollectionGate: () => ({ changeCollection: state.changeCollection }),
}));
vi.mock("./repository-context", () => ({
  useCollectionSummary: () => ({
    info: {
      name: "My unchanged collection",
      location: "Collection/unchanged.md",
    },
    stats: { open: 2, total: 5 },
    loading: false,
  }),
  useRepository: () => ({
    connection: { state: "available" },
    lastRefresh: { scanned: state.scanned, elapsedMs: 10 },
    refreshing: state.refreshing,
    refresh: state.refresh,
  }),
}));
afterEach(() => {
  cleanup();
  state.scanned = 1;
  state.refreshing = false;
  vi.clearAllMocks();
});
const panel = (locale = "en", target?: Parameters<typeof createPilotI18n>[1]) =>
  render(
    <I18nProvider i18n={createPilotI18n(locale, target)}>
      <CollectionSettingsContent />
    </I18nProvider>,
  );

describe("Lingui collection settings pilot", () => {
  it("keeps the ordinary English copy, provider-neutral data and controls", () => {
    panel();
    expect(screen.getByText("2 open · 5 total")).toBeInTheDocument();
    expect(screen.getByText("My unchanged collection")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(state.refresh).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "How tasks are stored" }),
    );
    expect(screen.getByText(storageExplanation())).toBeInTheDocument();
    expect(
      screen.getByText("Last refresh checked 1 record in 10 ms."),
    ).toBeInTheDocument();
    expect(screen.getByText("Collection/unchanged.md")).toBeInTheDocument();
  });
  it("localizes accessible names and interpolation without translating collection data", () => {
    panel("fr");
    expect(screen.getByText("2 ouvertes · 5 au total")).toBeInTheDocument();
    expect(screen.getByText("My unchanged collection")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Changer de collection" }),
    );
    expect(state.changeCollection).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Comment les tâches sont stockées" }),
    );
    expect(
      screen.getByText(/a vérifié 1 document en 10 ms/),
    ).toBeInTheDocument();
  });
  it.each([0, 1, 2, 1000])(
    "uses French CLDR plurals for %i records",
    (scanned) => {
      state.scanned = scanned;
      panel("fr");
      fireEvent.click(
        screen.getByRole("button", {
          name: "Comment les tâches sont stockées",
        }),
      );
      expect(
        screen.getByText(
          new RegExp(scanned <= 1 ? "document en" : "documents en"),
        ),
      ).toBeInTheDocument();
    },
  );
  it("merges missing target entries with English and falls back for unsupported locales", () => {
    panel("fr", {});
    expect(
      screen.getByRole("button", { name: "Refresh now" }),
    ).toBeInTheDocument();
    cleanup();
    panel("not-supported");
    expect(
      screen.getByRole("button", { name: "Change collection" }),
    ).toBeInTheDocument();
  });
  it("localizes rich text but keeps trusted link props and escapes interpolation", () => {
    render(
      <I18nProvider i18n={createPilotI18n("fr")}>
        <PilotRichText name={'<img src="evil">'} />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("link", { name: "la documentation" }),
    ).toHaveAttribute("href", "https://tasknotes.dev");
    expect(screen.getByText(/Bonjour <img src="evil">/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
