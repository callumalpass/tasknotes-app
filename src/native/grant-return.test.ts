import { expect, it } from "vitest";
import {
  grantCallbackFromHandoff,
  nativeGrantHandoff,
  nativeGrantReturnUrl,
  TASKNOTES_NATIVE_GRANT_HANDOFF_URL,
} from "./grant-return";

const RETURN = "https://app.tasknotes.dev/auth/mdbase/callback?via=app";

it("finds the app's grant redirect only where the manifest declares it", () => {
  const homepage = "https://app.tasknotes.dev/";
  expect(
    nativeGrantReturnUrl({
      homepage,
      redirect_uris: [
        "https://app.tasknotes.dev/auth/mdbase/callback",
        "dev.tasknotes.app://auth/mdbase/callback",
        RETURN,
      ],
    }),
  ).toBe(RETURN);
  expect(
    nativeGrantReturnUrl({
      homepage,
      redirect_uris: ["https://app.tasknotes.dev/auth/mdbase/callback"],
    }),
  ).toBeNull();
});

it("hands an app grant from the web page to the app and back unchanged", () => {
  const page = new URL(`${RETURN}&code=c0de&state=st4te`);
  const handoff = nativeGrantHandoff(page);
  expect(handoff).toBe(
    `${TASKNOTES_NATIVE_GRANT_HANDOFF_URL}?code=c0de&state=st4te`,
  );
  expect(grantCallbackFromHandoff(handoff!, RETURN)).toBe(page.href);
});

it("hands a refusal back too, so the app stops waiting", () => {
  const page = new URL(`${RETURN}&error=access_denied&state=st4te`);
  const back = grantCallbackFromHandoff(nativeGrantHandoff(page)!, RETURN);
  expect(back).toBe(page.href);
});

it.each([
  [
    "a web grant",
    "https://app.tasknotes.dev/auth/mdbase/callback?code=c&state=s",
  ],
  ["no state", `${RETURN}&code=c`],
  ["no result", `${RETURN}&state=s`],
])("leaves %s on the web page", (_case, url) => {
  expect(nativeGrantHandoff(new URL(url))).toBeNull();
});

it.each([
  "https://evil.test/auth/mdbase/grant?code=c&state=s",
  "dev.tasknotes.app://evil/mdbase/grant?code=c&state=s",
  "dev.tasknotes.app://auth/mdbase/callback?code=c&state=s",
  "dev.tasknotes.app://user@auth/mdbase/grant?code=c&state=s",
  "dev.tasknotes.app://auth/mdbase/grant?code=c&state=s#x",
  "dev.tasknotes.app://auth/mdbase/grant?code=c",
  "not a url",
])("ignores %s in the app", (url) => {
  expect(grantCallbackFromHandoff(url, RETURN)).toBeNull();
});
