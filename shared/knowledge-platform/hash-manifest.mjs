#!/usr/bin/env node
// Deterministic hash manifest for released Knowledge Platform files.
//
//   node shared/knowledge-platform/hash-manifest.mjs --check
//   node shared/knowledge-platform/hash-manifest.mjs --release <version>
//
// --check   fails if any released file's exact bytes differ from its pinned hash,
//           or if a *.json platform file is not listed in the manifest.
// --release appends a new version (never rewrites an existing entry).

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platformHashOf } from "../knowledge-v2/platform.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(DIR, "manifest.json");
const FORMAT = "sona.knowledge-platform.manifest/v1";

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { format: FORMAT, releases: [] };
    throw error;
  }
}

function serialize(manifest) {
  const releases = [...manifest.releases].sort((a, b) => a.version.localeCompare(b.version));
  return `${JSON.stringify({ format: FORMAT, releases }, null, 2)}\n`;
}

async function check() {
  const manifest = await readManifest();
  const problems = [];
  for (const entry of manifest.releases) {
    const bytes = new Uint8Array(await readFile(join(DIR, entry.file)));
    const hash = await platformHashOf(bytes);
    if (hash !== entry.sha256) problems.push(`${entry.version}: bytes changed after release`);
  }
  const listed = new Set(manifest.releases.map((entry) => entry.file));
  for (const name of await readdir(DIR)) {
    if (name.endsWith(".json") && name !== "manifest.json" && !listed.has(name)) {
      problems.push(`${name}: not listed in manifest`);
    }
  }
  if ((await readFile(MANIFEST, "utf8")) !== serialize(manifest)) {
    problems.push("manifest.json is not in canonical form");
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`ok: ${manifest.releases.length} released platform file(s) verified`);
}

async function release(version) {
  const manifest = await readManifest();
  if (manifest.releases.some((entry) => entry.version === version)) {
    console.error(`${version} is already released; released files are immutable.`);
    process.exit(1);
  }
  const file = `${version}.json`;
  const bytes = new Uint8Array(await readFile(join(DIR, file)));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (parsed.version !== version) {
    console.error(`${file} declares version ${parsed.version}.`);
    process.exit(1);
  }
  manifest.releases.push({ version, file, sha256: await platformHashOf(bytes) });
  await writeFile(MANIFEST, serialize(manifest));
  console.log(`released ${version}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "--check") await check();
else if (mode === "--release" && arg) await release(arg);
else {
  console.error("usage: hash-manifest.mjs --check | --release <version>");
  process.exit(2);
}
