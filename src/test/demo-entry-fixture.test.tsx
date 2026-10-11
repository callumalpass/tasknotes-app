import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { DemoEntryFixture } from "./demo-entry-fixture";

vi.mock("../app/tasknotes-app", () => ({
  TaskNotesApp: () => <p>Native gate</p>,
}));
vi.mock("../demo/demo-app", () => ({
  DemoApp: ({ count }: { count: number }) => <p>Demo {String(count)}</p>,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["/?demo=50", "Demo 50"],
  ["/embed", "Native gate"],
  ["/embed/?demo=0", "Native gate"],
  ["/?demo=0", "Native gate"],
  ["/?demo=not-a-number", "Native gate"],
])("retains original local test routing for %s", (path, expected) => {
  vi.stubEnv("MODE", "e2e");
  history.replaceState({}, "", path);
  render(
    <StrictMode>
      <DemoEntryFixture />
    </StrictMode>,
  );
  expect(screen.getByText(expected)).toBeInTheDocument();
});
it("refuses a non-e2e build before accessing the demo backend", () => {
  vi.stubEnv("MODE", "production");
  expect(() => DemoEntryFixture()).toThrow("local e2e build");
});
it("refuses non-loopback origins even in e2e mode", () => {
  vi.stubEnv("MODE", "e2e");
  vi.stubGlobal("location", new URL("https://example.test/?demo=50"));
  expect(() => DemoEntryFixture()).toThrow("local e2e build");
});
