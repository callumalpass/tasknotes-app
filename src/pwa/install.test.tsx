import { act, render, screen } from "@testing-library/react";

it("offers installation only after the browser provides an install prompt", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
    })),
  });
  const prompt = vi.fn(() => Promise.resolve());
  const installEvent = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    },
  );
  const { initializePwaInstall, requestPwaInstall, usePwaInstall } =
    await import("./install");

  function InstallState() {
    return <span>{usePwaInstall()}</span>;
  }

  initializePwaInstall();
  render(<InstallState />);
  expect(screen.getByText("unavailable")).toBeVisible();

  await act(() => window.dispatchEvent(installEvent));
  expect(installEvent.defaultPrevented).toBe(true);
  expect(screen.getByText("available")).toBeVisible();

  await act(() => requestPwaInstall());
  expect(prompt).toHaveBeenCalledOnce();
  expect(screen.getByText("installed")).toBeVisible();
});
