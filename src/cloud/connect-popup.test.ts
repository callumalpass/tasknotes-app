import { openConnectPopup } from "./connect-popup";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const popup = {
    opener: {} as unknown,
    closed: false,
    location: { href: "" },
    close: vi.fn(),
  };
  return { popup, handle: popup as unknown as Window };
}
it("reserves the first-party production popup synchronously, retains its opener and navigates only the original handle", () => {
  const f = fixture(),
    open = vi.spyOn(window, "open").mockReturnValue(f.handle);
  const portal = openConnectPopup();
  expect(open).toHaveBeenCalledExactlyOnceWith(
    "",
    "mdbase-connect-authorization",
    "popup,width=620,height=760",
  );
  expect(f.popup.opener).not.toBeNull();
  expect(f.popup.location.href).toBe("");
  portal.navigate("https://connect-lab.mdbase.dev/pair/original");
  expect(f.popup.location.href).toBe(
    "https://connect-lab.mdbase.dev/pair/original",
  );
  portal.close();
  portal.close();
  expect(f.popup.close).toHaveBeenCalledOnce();
});
it("uses a tab fallback only when the popup is blocked", () => {
  const f = fixture(),
    open = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(f.handle);
  openConnectPopup().close();
  expect(open.mock.calls).toEqual([
    ["", "mdbase-connect-authorization", "popup,width=620,height=760"],
    ["", "_blank"],
  ]);
});
it("also tries the tab after a browser popup exception", () => {
  const f = fixture(),
    open = vi
      .spyOn(window, "open")
      .mockImplementationOnce(() => {
        throw Error("blocked");
      })
      .mockReturnValueOnce(f.handle);
  openConnectPopup().close();
  expect(open).toHaveBeenCalledTimes(2);
});
it("reports both blocked attempts without inventing a sign-in result", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  expect(() => openConnectPopup()).toThrow(
    "Your browser blocked the sign-in window.",
  );
});
it("refuses and closes a handle whose opener cannot be detached", () => {
  const f = fixture();
  Object.defineProperty(f.popup, "opener", {
    set() {
      throw Error("refused");
    },
  });
  vi.spyOn(window, "open")
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(f.handle);
  expect(() => openConnectPopup()).toThrow("blocked");
  expect(f.popup.close).toHaveBeenCalledOnce();
});
it("does not reopen or navigate after manual close", () => {
  const f = fixture(),
    open = vi.spyOn(window, "open").mockReturnValue(f.handle),
    portal = openConnectPopup();
  f.popup.closed = true;
  expect(() =>
    portal.navigate("https://connect-lab.mdbase.dev/pair/original"),
  ).toThrow("closed");
  expect(open).toHaveBeenCalledOnce();
  portal.close();
});
it("display close failure cannot become a native owner shutdown failure", () => {
  const f = fixture();
  f.popup.close.mockImplementation(() => {
    throw Error("browser refused");
  });
  vi.spyOn(window, "open").mockReturnValue(f.handle);
  const portal = openConnectPopup();
  expect(() => portal.close()).not.toThrow();
  portal.close();
  expect(f.popup.close).toHaveBeenCalledOnce();
});
