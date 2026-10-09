// Generated ONLY after shared BUILD-time mdbn-trust verification.
// PUBLIC environment release context, not grant authority/readiness/key isolation.
const metadata = {"schema":"mdbn-app-trust/release/1","environment":"lab","cpOrigin":"https://connect-lab.mdbase.dev","logOrigin":"https://mdbase-next-log-lab-20261005.callumalpass.workers.dev","assetSha256":"88fe5249be83d7db9999d88d4f62acaca79e8bdcabe2c9f236e2942014de3334","source":{"commit":"8a014fe2abd2d9c6a8b1ed3e77c35cfda3392d3e","repository":"mdbase-dev/mdbase-connect","version":"0.1.0-beta.129"}};
Object.freeze(metadata.source); Object.freeze(metadata);
const rootHex = Object.freeze(["2a5a3df0260259f5e6b8ce05ec9b66f5c649022456fd72026647e368acf2cb30"]);
const pinsHex = "828182507554e3aa62bbed3ef2f01b630f94d7ef58202a5a3df0260259f5e6b8ce05ec9b66f5c649022456fd72026647e368acf2cb308183501054409eba35bba607fb60b641f15f815820206be8992be796f514e0b9f443135429c74b6f87bcf0dc62d46c8d5c42d25047507554e3aa62bbed3ef2f01b630f94d7ef";
const bytes = (hex) => { const value = new Uint8Array(hex.length / 2); for (let i = 0; i < value.length; i++) value[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return value; };
export function appReleaseTrust() {
  return Object.freeze({ ...metadata, trustedRoots: Object.freeze(rootHex.map(bytes)), policyPins: bytes(pinsHex) });
}
