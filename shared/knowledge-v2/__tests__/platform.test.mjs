import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PlatformIntegrityError,
  platformHashOf,
  verifyPlatformBytes,
} from "../platform.mjs";
import { DEFAULT_PLATFORM_DIR, loadPlatformFromRepo, readPlatformManifest } from "../platform-node.mjs";

// Frozen registry of released platform files. A released file may never change:
// changing one requires editing this constant, which is visible in review.
const RELEASED_PLATFORM_HASHES = Object.freeze({
  "sona-0.6.0": "sha256:29e03a4d3f2b7179542fa50479bc4fda21cafcf8a56ce28d677eb5f4fdb04243",
  "returns-0.1.0": "sha256:5ef1d37f65919396f65cad2f15fca17209e1e6c4caea19c9f92bff1ecbe90458",
  "product-support-0.1.0": "sha256:df081fd745ee5701afc41874f56beaa2f4688805fa8b83ac7709530b8c2800da",
  "product-support-0.2.0": "sha256:351557dfb333af75449353f4611bcddc0855af31b8b81b5e5e16a4b71cddf004",
  "product-support-0.3.0": "sha256:513d4ac07991669f15fecf71a184d25cf21024a0705a1cc1faceb2fd9d4afb8f",
  "sona-0.2.0": "sha256:5ba618cfa4871f329372f053ea9790d17e546a798e3c2ab172e648fd4140a597",
  "sona-0.3.0": "sha256:42f2ce3defbfc2c3a5cb57f97efa2c9175e84ae900c94a26dec0700e3da5285d",
  "order-status-0.1.0": "sha256:6b319a9c87dbbe66728ff79fb47f921f1371a7144414f15d4bfc3f795ba09e85",
  "sona-0.4.0": "sha256:85a5e3484bbe839991ce3ce7459e938889b3e2bb52e6e8f0d91fb54fd26c0781",
  "sona-0.5.0": "sha256:4a56a8a38777365f27fd9912c04893da2f15134179bbae09435be3e9e9d5bde6",
  "warranty-0.1.0": "sha256:5c494f94d4bd9f8d441cb79bca0b1175c11ceb3d4aa8c4a32f89a08b0fade268",
});

test("every released platform file matches the frozen hash registry", async () => {
  const manifest = await readPlatformManifest();
  for (const [version, hash] of Object.entries(RELEASED_PLATFORM_HASHES)) {
    const entry = manifest.releases.find((release) => release.version === version);
    assert.ok(entry, `${version} must stay in the manifest`);
    assert.equal(entry.sha256, hash, `${version} manifest hash changed`);
    const bytes = new Uint8Array(await readFile(join(DEFAULT_PLATFORM_DIR, entry.file)));
    assert.equal(await platformHashOf(bytes), hash, `${version} bytes changed`);
  }
  for (const entry of manifest.releases) {
    assert.ok(entry.version in RELEASED_PLATFORM_HASHES, `${entry.version} missing from frozen registry`);
  }
});

test("hash-manifest --check passes", () => {
  const output = execFileSync(process.execPath, [join(DEFAULT_PLATFORM_DIR, "hash-manifest.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.match(output, /verified/);
});

test("loader returns the verified platform with its pin", async () => {
  const loaded = await loadPlatformFromRepo("returns-0.1.0");
  assert.equal(loaded.version, "returns-0.1.0");
  assert.equal(loaded.hash, RELEASED_PLATFORM_HASHES["returns-0.1.0"]);
  assert.equal(loaded.platform.version, "returns-0.1.0");
  assert.ok(Object.isFrozen(loaded));
});

test("a single changed byte is rejected", async () => {
  const bytes = new Uint8Array(await readFile(join(DEFAULT_PLATFORM_DIR, "returns-0.1.0.json")));
  const tampered = bytes.slice();
  tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x20 ? 0x0a : 0x20;
  await assert.rejects(
    verifyPlatformBytes(tampered, { version: "returns-0.1.0", sha256: RELEASED_PLATFORM_HASHES["returns-0.1.0"] }),
    (error) => error instanceof PlatformIntegrityError && error.code === "platform.hash_mismatch",
  );
});

test("re-serialized JSON with identical content is rejected (exact bytes only)", async () => {
  const bytes = await readFile(join(DEFAULT_PLATFORM_DIR, "returns-0.1.0.json"), "utf8");
  const reserialized = new TextEncoder().encode(JSON.stringify(JSON.parse(bytes)));
  await assert.rejects(
    verifyPlatformBytes(reserialized, { version: "returns-0.1.0", sha256: RELEASED_PLATFORM_HASHES["returns-0.1.0"] }),
    (error) => error.code === "platform.hash_mismatch",
  );
});

test("a declared version that differs from the pin is rejected", async () => {
  const bytes = new Uint8Array(await readFile(join(DEFAULT_PLATFORM_DIR, "returns-0.1.0.json")));
  await assert.rejects(
    verifyPlatformBytes(bytes, { version: "returns-0.1.1", sha256: RELEASED_PLATFORM_HASHES["returns-0.1.0"] }),
    (error) => error.code === "platform.version_mismatch",
  );
});

test("unknown versions are rejected", async () => {
  await assert.rejects(loadPlatformFromRepo("returns-9.9.9"), (error) => error.code === "platform.unknown_version");
});

test("sona-0.3.0 adds Warranty without changing frozen Returns or Product Support vocabulary", async () => {
  const before = (await loadPlatformFromRepo("sona-0.2.0")).platform;
  const after = (await loadPlatformFromRepo("sona-0.3.0")).platform;
  for (const key of Object.keys(before.facts)) assert.deepEqual(after.facts[key], before.facts[key], `fact ${key} changed`);
  for (const key of Object.keys(before.slots)) assert.deepEqual(after.slots[key], before.slots[key], `slot ${key} changed`);
  for (const key of Object.keys(before.families)) assert.deepEqual(after.families[key], before.families[key], `family ${key} changed`);
  for (const [key, value] of Object.entries(before.domains)) {
    if (key !== "complaints_warranty") assert.deepEqual(after.domains[key], value, `domain ${key} changed`);
  }
  for (const [name, values] of Object.entries(before.enums)) {
    if (["unit_kind", "audience"].includes(name)) {
      for (const value of values) assert.ok(after.enums[name].includes(value), `${name}.${value} lost`);
    } else assert.deepEqual(after.enums[name], values, `enum ${name} changed`);
  }
  assert.equal(after.domains.complaints_warranty.status, "implemented");
  assert.deepEqual(after.enums.warranty_resolution_outcome, ["evidence_required", "eligible_for_review", "requires_human_review", "not_covered"]);
  assert.ok(!after.enums.warranty_resolution_outcome.includes("resolved_replacement_or_repair"));
});

test("platform file is internally consistent", async () => {
  const { platform } = await loadPlatformFromRepo("returns-0.1.0");
  const methods = new Set(platform.establishment_methods);
  const purposes = platform.purposes;

  for (const [key, fact] of Object.entries(platform.facts)) {
    assert.ok(platform.subjects[fact.subject], `${key}: unknown subject`);
    for (const purpose of purposes) {
      const rule = fact.purposes?.[purpose];
      assert.ok(rule, `${key}: missing purpose ${purpose}`);
      assert.ok(rule.methods.length > 0, `${key}.${purpose}: no methods`);
      for (const method of rule.methods) assert.ok(methods.has(method), `${key}.${purpose}: unknown method ${method}`);
      assert.ok(rule.methods.includes(rule.sufficient), `${key}.${purpose}: sufficient method not permitted`);
    }
    if (fact.enum) assert.ok(platform.enums[fact.enum], `${key}: unknown enum ${fact.enum}`);
  }

  const enumRefs = [];
  const collectEnums = (schema) => {
    if (!schema) return;
    if (schema.enum) enumRefs.push(schema.enum);
    for (const child of Object.values(schema.properties ?? {})) collectEnums(child);
  };
  for (const [slotKey, slot] of Object.entries(platform.slots)) {
    assert.ok(platform.families[slot.family], `${slotKey}: unknown family`);
    const domain = platform.families[slot.family].domain;
    assert.ok(slotKey.startsWith(`${domain}.${slot.family}.`), `${slotKey}: key must be domain.family.slot`);
    collectEnums(slot.value_schema);
  }
  for (const name of enumRefs) assert.ok(platform.enums[name], `unknown enum ${name}`);

  const unitKinds = new Set(platform.enums.unit_kind);
  assert.deepEqual(new Set(Object.keys(platform.unit_kinds)), unitKinds);
  for (const [kind, declarations] of Object.entries(platform.reference_paths)) {
    if (kind !== "_all") assert.ok(unitKinds.has(kind), `reference_paths: unknown kind ${kind}`);
    for (const declaration of declarations) {
      assert.ok(["unit", "source", "policy", "review_item"].includes(declaration.target), `${kind}: bad target`);
      for (const targetKind of declaration.target_kinds ?? []) assert.ok(unitKinds.has(targetKind));
    }
  }

  for (const [from, to] of platform.exits.graph) {
    assert.ok(platform.domains[from], `exit from unknown domain ${from}`);
    assert.ok(platform.domains[to], `exit to unknown domain ${to}`);
  }
  assert.ok(Number.isInteger(platform.exits.max_depth) && platform.exits.max_depth >= 1);
  for (const family of [...platform.domains.returns.core_families, ...platform.domains.returns.on_demand_families]) {
    assert.ok(platform.families[family], `returns family ${family} undeclared`);
  }
  assert.deepEqual(
    [...platform.domains.returns.core_families, ...platform.domains.returns.on_demand_families].sort(),
    ["ELIG", "EXCH", "LOG", "MONEY", "PROC"],
  );
  assert.deepEqual(platform.enums.truth_value, ["true", "false", "unknown"]);
  assert.deepEqual(platform.enums.requirement_stage, ["to_initiate", "to_approve", "to_ship", "to_refund"]);
});
