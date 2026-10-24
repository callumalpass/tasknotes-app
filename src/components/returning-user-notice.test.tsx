import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "../test/render";
import { afterEach, describe, expect, it } from "vitest";
import { ReturningUserNotice } from "./returning-user-notice";

afterEach(cleanup);
const marker = "tasknotes:mdbase-upgrade-notice:v1";
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
}
describe("returning-user update notice", () => {
  it.each([
    "tasknotes:navigation-views:v3",
    "tasknotes:primary-views:v1",
    "tasknotes:calendar-preferences:v1",
    "tasknotes:scratchpad-default-mode:v1",
    "tasknotes:recent-searches:v1:original",
  ])("recognizes old key presence without parsing %s", (key) => {
    const storage = memoryStorage();
    storage.setItem(key, "original bytes, not JSON");
    const originalGet = storage.getItem;
    storage.getItem = (read) => {
      if (read !== marker) throw new Error("old values must not be read");
      return originalGet(read);
    };
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(
      screen.getByRole("complementary", { name: "mdbase update" }),
    ).toHaveTextContent(
      "mdbase was upgraded. Approve TaskNotes once to continue. Your collections and notes are unchanged.",
    );
    expect(
      screen.getByText("Private collections need your desktop online."),
    ).toBeVisible();
    expect(originalGet(key)).toBe("original bytes, not JSON");
  });
  it("shows once on an actual visit even without dismissal", () => {
    const storage = memoryStorage();
    storage.setItem("tasknotes:navigation-views:v4", "old");
    const first = render(
      <StrictMode>
        <ReturningUserNotice getStorage={() => storage} />
      </StrictMode>,
    );
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(storage.getItem(marker)).toBe("seen");
    first.unmount();
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("dismisses without blocking work and stays dismissed on reload", () => {
    const storage = memoryStorage();
    storage.setItem("tasknotes:scratchpad-collapse:old", "old");
    const first = render(
      <>
        <ReturningUserNotice getStorage={() => storage} />
        <input aria-label="Work" />
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Work" });
    input.focus();
    fireEvent.change(input, { target: { value: "My unsaved work" } });
    expect(input).toHaveValue("My unsaved work");
    expect(input).toHaveFocus();
    const link = screen.getByRole("link", { name: "Learn more" });
    expect(link).toHaveAttribute("href", "https://mdbase.dev/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(input).toHaveValue("My unsaved work");
    first.unmount();
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("does not mistake a fresh user's later new-engine preferences for old usage", () => {
    const storage = memoryStorage();
    storage.setItem("mdbase:theme", "dark");
    const first = render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    first.unmount();
    storage.setItem("tasknotes:navigation-views:v4", "new engine");
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("a preexisting persisted marker prevents another notice", () => {
    const storage = memoryStorage();
    storage.setItem("tasknotes:navigation-views:v4", "old");
    storage.setItem(marker, "seen");
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("quota failure stays harmless and dismissal works for this app lifetime", () => {
    const storage = memoryStorage();
    storage.setItem("tasknotes:navigation-views:v4", "old");
    storage.setItem = () => {
      throw new Error("quota");
    };
    const first = render(<ReturningUserNotice getStorage={() => storage} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    first.unmount();
    render(<ReturningUserNotice getStorage={() => storage} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(storage.getItem(marker)).toBeNull();
  });
  it("an inaccessible browser storage getter silently skips the notice", () => {
    render(
      <>
        <ReturningUserNotice
          getStorage={() => {
            throw new Error("privacy policy");
          }}
        />
        <input aria-label="Work" />
      </>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
});
