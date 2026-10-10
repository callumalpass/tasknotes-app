import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function provisioningDirectory(variable) {
  const directory = process.env[variable];
  if (!directory)
    throw Error(
      `Explicit approved disposable LAB locator required: ${variable}`,
    );
  return directory;
}
export function assertDisposableLocator(
  key,
  expectedPurpose = "clients-disposable-signup",
) {
  if (
    !key ||
    key.environment !== "lab" ||
    key.purpose !== expectedPurpose ||
    key.purpose === "lab-acceptance" ||
    Object.keys(key).sort().join(",") !==
      "application,environment,fixture,purpose" ||
    Object.values(key).some((value) => typeof value !== "string" || !value)
  )
    throw Error("Invalid disposable LAB credential locator");
}

export function decodeCredentialPayload(stored, expectedEmail) {
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw Error("Invalid disposable credential payload format");
  }
  if (
    !parsed ||
    Object.keys(parsed).sort().join(",") !== "email,password" ||
    parsed.email !== expectedEmail ||
    typeof parsed.password !== "string" ||
    !parsed.password ||
    parsed.password.length > 1024
  )
    throw Error("Invalid disposable credential payload binding");
  return { email: parsed.email, password: parsed.password };
}

// Credential material never leaves this process except through ordinary UI
// field fill. No stdout, traces, cookie imports, fallback aliases or signup.
export function disposableCredentials() {
  return loadCredentials(
    provisioningDirectory("E2E_PRIMARY_PROVISIONING_DIR"),
    "clients-account-created.json",
    true,
  );
}

export function sharingCredentials() {
  return loadCredentials(
    provisioningDirectory("E2E_SHARING_PROVISIONING_DIR"),
    "sharing-account-created.json",
    false,
  );
}

async function loadCredentials(directory, metadataName, primary) {
  const email = (
    await readFile(resolve(directory, "disposable-email.txt"), "utf8")
  ).trim();
  const metadata = JSON.parse(
    await readFile(resolve(directory, metadataName), "utf8"),
  );
  assertDisposableLocator(
    metadata.credential_key,
    primary ? "clients-disposable-signup" : metadata.credential_key?.purpose,
  );
  const attributes = Object.entries(metadata.credential_key).flat();
  const options = {
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "ignore"],
  };
  let stored;
  try {
    let items = execFileSync(
      "secret-tool",
      ["search", "--all", ...attributes],
      options,
    );
    const count = (items.match(/^\[\//gm) ?? []).length;
    items = "";
    if (count !== 1) throw Error("Ambiguous or missing keyring locator");
    stored = execFileSync(
      "secret-tool",
      ["lookup", ...attributes],
      options,
    ).trim();
  } catch {
    throw Error(
      "Disposable-account exact keyring lookup unavailable or ambiguous",
    );
  }
  if (!email || !stored || typeof metadata.account_id !== "string")
    throw Error("Disposable-account credentials unavailable");
  const credentials = decodeCredentialPayload(stored, email);
  return { ...credentials, accountId: metadata.account_id };
}
