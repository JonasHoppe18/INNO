// Node-only loader: reads a released platform file from the repo and verifies
// its exact bytes against the committed hash manifest.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlatformIntegrityError, verifyPlatformBytes } from "./platform.mjs";

const SOURCE_PLATFORM_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "knowledge-platform",
);

// Next bundles import.meta.url as the build-machine source path. Resolve the
// shipped repository assets from the runtime working directory first.
export const DEFAULT_PLATFORM_DIR = [
  join(process.cwd(), "shared", "knowledge-platform"),
  join(process.cwd(), "..", "..", "shared", "knowledge-platform"),
  SOURCE_PLATFORM_DIR,
].find(directory => existsSync(join(directory, "manifest.json"))) || SOURCE_PLATFORM_DIR;

export async function readPlatformManifest(platformDir = DEFAULT_PLATFORM_DIR) {
  const raw = await readFile(join(platformDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  if (manifest?.format !== "sona.knowledge-platform.manifest/v1" || !Array.isArray(manifest.releases)) {
    throw new PlatformIntegrityError("invalid_manifest", "Platform manifest is malformed.");
  }
  return manifest;
}

export async function loadPlatformFromRepo(version, platformDir = DEFAULT_PLATFORM_DIR) {
  const manifest = await readPlatformManifest(platformDir);
  const entry = manifest.releases.find((release) => release.version === version);
  if (!entry) {
    throw new PlatformIntegrityError("platform.unknown_version", `Platform ${version} is not in the manifest.`);
  }
  if (entry.file !== `${version}.json`) {
    throw new PlatformIntegrityError("invalid_manifest", `Manifest file name for ${version} is unexpected.`);
  }
  const bytes = await readFile(join(platformDir, entry.file));
  return verifyPlatformBytes(new Uint8Array(bytes), { version, sha256: entry.sha256 });
}
