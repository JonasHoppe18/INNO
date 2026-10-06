// Knowledge V2 platform integrity.
//
// A platform file is pinned by version + SHA-256 of its exact bytes. The bytes
// are never re-serialized before hashing. Runtime-neutral (Node 20+ and Deno):
// uses WebCrypto only.

export const PLATFORM_FORMAT = "sona.knowledge-platform/v1";
export const PLATFORM_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const PLATFORM_VERSION_PATTERN = /^[a-z][a-z0-9-]*-\d+\.\d+\.\d+$/;

export class PlatformIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformIntegrityError";
    this.code = code;
  }
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Platform bytes must be a Uint8Array or ArrayBuffer.");
}

export async function sha256Hex(input) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toBytes(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function platformHashOf(input) {
  return `sha256:${await sha256Hex(input)}`;
}

// Verifies exact bytes against the pinned hash and version, then parses.
export async function verifyPlatformBytes(input, expected) {
  const bytes = toBytes(input);
  const expectedHash = String(expected?.sha256 ?? "");
  const expectedVersion = String(expected?.version ?? "");
  if (!PLATFORM_HASH_PATTERN.test(expectedHash)) {
    throw new PlatformIntegrityError("invalid_expected_hash", "Expected platform hash is malformed.");
  }
  if (!PLATFORM_VERSION_PATTERN.test(expectedVersion)) {
    throw new PlatformIntegrityError("invalid_expected_version", "Expected platform version is malformed.");
  }
  const actualHash = await platformHashOf(bytes);
  if (actualHash !== expectedHash) {
    throw new PlatformIntegrityError(
      "platform.hash_mismatch",
      `Platform ${expectedVersion} bytes do not match the pinned hash.`,
    );
  }
  let platform;
  try {
    platform = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PlatformIntegrityError("invalid_platform_json", `Platform ${expectedVersion} is not valid UTF-8 JSON.`);
  }
  if (platform?.format !== PLATFORM_FORMAT) {
    throw new PlatformIntegrityError("invalid_platform_format", `Platform ${expectedVersion} has an unknown format.`);
  }
  if (platform?.version !== expectedVersion) {
    throw new PlatformIntegrityError(
      "platform.version_mismatch",
      `Platform file declares ${platform?.version}, expected ${expectedVersion}.`,
    );
  }
  return Object.freeze({ version: expectedVersion, hash: actualHash, platform });
}
