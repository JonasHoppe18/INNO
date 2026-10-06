import { supportSourceConflicts } from "./merchant-support.mjs";
// Release sealing preparation (A2 + A4).
//
// Produces the payload for public.kn2_seal_release. The database repeats the
// tenant and membership checks; this module owns platform validation, which the
// database cannot do because it does not read platform files.
//
// Tenant identifiers are deliberately absent here: the server-side caller adds
// workspace_id/shop_id from its authorized context (A1).

import { sha256Hex } from "./platform.mjs";
import { extractReferences } from "./references.mjs";
import { validateUnit } from "./units.mjs";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function unitContentHash(unit) {
  const material = canonicalJson({
    kind: unit.kind,
    domain_key: unit.domain_key,
    family_key: unit.family_key ?? null,
    slot_key: unit.slot_key ?? null,
    audience: unit.audience,
    period_start: unit.period_start ?? null,
    period_end: unit.period_end ?? null,
    period_basis: unit.period_basis ?? null,
    scope: unit.scope ?? {},
    payload: unit.payload,
  });
  return `sha256:${await sha256Hex(new TextEncoder().encode(material))}`;
}

function periodsOverlap(a, b) {
  const aStart = a.period_start ? Date.parse(a.period_start) : -Infinity;
  const aEnd = a.period_end ? Date.parse(a.period_end) : Infinity;
  const bStart = b.period_start ? Date.parse(b.period_start) : -Infinity;
  const bEnd = b.period_end ? Date.parse(b.period_end) : Infinity;
  if ((a.period_basis ?? null) !== (b.period_basis ?? null) && (a.period_basis || b.period_basis)) return true;
  return aStart < bEnd && bStart < aEnd;
}

function precedenceTargets(unit) {
  return new Set((unit.payload?.precedence ?? []).map((edge) => String(edge?.overrides ?? "").toLowerCase()));
}

// input: {
//   platform: result of verifyPlatformBytes(),
//   parent: null | { seq, platform_version, platform_hash },
//   members: unit versions that are members of the parent release,
//   add: unit drafts to publish (new units or replacements of existing unit_ids),
//   close: unit_ids removed from the release,
//   kind: "publish" | "rollback" | "platform_adoption",
// }
export async function prepareSeal(input) {
  const errors = [];
  const { platform: pinned, parent = null, members = [], add = [], close = [], kind } = input;
  const platform = pinned.platform;

  const adopting = Boolean(parent && parent.platform_hash !== pinned.hash);
  if (!parent && kind !== "publish") {
    errors.push({ code: "seal.first_release_kind", message: "The first release must be a publish." });
  }
  if (adopting && kind !== "platform_adoption" && kind !== "rollback") {
    errors.push({ code: "seal.platform_change_requires_adoption", message: "A new platform pin requires a platform_adoption release." });
  }
  if (kind === "platform_adoption" && !adopting) {
    errors.push({ code: "seal.adoption_without_platform_change", message: "platform_adoption must change the platform pin." });
  }

  const memberByUnit = new Map(members.map((member) => [String(member.unit_id).toLowerCase(), member]));
  const closing = new Set(close.map((unitId) => String(unitId).toLowerCase()));
  for (const unitId of closing) {
    if (!memberByUnit.has(unitId)) errors.push({ code: "seal.close_unknown_unit", message: `Unit ${unitId} is not a member.` });
  }

  const added = [];
  const seenAdded = new Set();
  for (const draft of add) {
    const unitId = String(draft.unit_id).toLowerCase();
    if (seenAdded.has(unitId)) {
      errors.push({ code: "seal.duplicate_unit", message: `Unit ${unitId} is added twice.` });
      continue;
    }
    seenAdded.add(unitId);
    const previous = memberByUnit.get(unitId);
    if (previous && previous.kind !== draft.kind) {
      errors.push({ code: "seal.kind_change", message: `Unit ${unitId} cannot change kind.` });
    }
    if (closing.has(unitId)) {
      errors.push({ code: "seal.add_and_close", message: `Unit ${unitId} is both added and closed.` });
    }
    added.push({ ...draft, unit_id: unitId, version: previous ? Number(previous.version) + 1 : 1 });
  }

  const resulting = new Map();
  for (const [unitId, member] of memberByUnit) {
    if (!closing.has(unitId) && !seenAdded.has(unitId)) resulting.set(unitId, member);
  }
  for (const unit of added) resulting.set(unit.unit_id, unit);

  // A2: a platform change revalidates every resulting member, not only changed units.
  const toValidate = adopting ? [...resulting.values()] : added;
  const declaredRefsByUnit = new Map();
  for (const unit of toValidate) {
    const unitId = String(unit.unit_id).toLowerCase();
    for (const error of validateUnit(platform, unit)) errors.push({ ...error, unit_id: unitId });
    const { references, errors: referenceErrors } = extractReferences(platform, unit.kind, unit.payload);
    for (const error of referenceErrors) errors.push({ ...error, unit_id: unitId });
    for (const reference of references) {
      if (reference.target !== "unit") continue;
      const target = resulting.get(reference.id);
      if (!target) {
        errors.push({ code: "reference.unit_not_member", unit_id: unitId, location: reference.location, message: `Referenced unit ${reference.id} is not in this release.` });
      } else if (reference.targetKinds && !reference.targetKinds.includes(target.kind)) {
        errors.push({ code: "reference.target_kind", unit_id: unitId, location: reference.location, message: `Referenced unit ${reference.id} has kind ${target.kind}.` });
      } else if (reference.id === unitId) {
        errors.push({ code: "reference.self", unit_id: unitId, location: reference.location, message: "A unit cannot reference itself." });
      }
    }
    declaredRefsByUnit.set(unitId, references.map(({ target, id }) => ({ target, id })));
  }

  // I7 (structural part): identical slot + identical scope + overlapping period
  // needs a declared precedence edge between the two units.
  const slotUnits = [...resulting.values()].filter((unit) => unit.kind === "slot_rule");
  for (let i = 0; i < slotUnits.length; i++) {
    for (let j = i + 1; j < slotUnits.length; j++) {
      const a = slotUnits[i];
      const b = slotUnits[j];
      if (a.slot_key !== b.slot_key) continue;
      if (canonicalJson(a.scope ?? {}) !== canonicalJson(b.scope ?? {})) continue;
      if (!periodsOverlap(a, b)) continue;
      const aId = String(a.unit_id).toLowerCase();
      const bId = String(b.unit_id).toLowerCase();
      if (precedenceTargets(a).has(bId) || precedenceTargets(b).has(aId)) continue;
      errors.push({ code: "conflict.value", message: `Units ${aId} and ${bId} set ${a.slot_key} for the same scope and period without declared precedence.` });
    }
  }

  errors.push(...supportSourceConflicts([...resulting.values()]));
  if (errors.length) return { ok: false, errors };

  const addRows = [];
  for (const unit of added) {
    addRows.push({
      unit_id: unit.unit_id,
      version: unit.version,
      kind: unit.kind,
      domain_key: unit.domain_key,
      family_key: unit.family_key ?? null,
      slot_key: unit.slot_key ?? null,
      audience: unit.audience,
      period_start: unit.period_start ?? null,
      period_end: unit.period_end ?? null,
      period_basis: unit.period_basis ?? null,
      scope: unit.scope ?? {},
      payload: unit.payload,
      content_hash: await unitContentHash(unit),
      origin_policy_id: unit.origin_policy_id,
      declared_refs: declaredRefsByUnit.get(unit.unit_id) ?? [],
    });
  }

  const replaced = added.filter((unit) => memberByUnit.has(unit.unit_id)).map((unit) => unit.unit_id);
  return {
    ok: true,
    errors: [],
    rpc: {
      platform_version: pinned.version,
      platform_hash: pinned.hash,
      kind,
      expected_parent_seq: parent ? parent.seq : null,
      add: addRows,
      close: [...new Set([...closing, ...replaced])],
      revalidated_unit_ids: adopting ? [...resulting.keys()] : [],
    },
  };
}
