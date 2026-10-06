// A4: JSONB references inside unit payloads.
//
// Only paths declared by the pinned platform file may hold references. Any
// UUID-shaped string anywhere else in a payload is an error (it would be an
// undeclared, unvalidated cross-row reference).

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePath(path) {
  return String(path)
    .split(".")
    .map((segment) =>
      segment.endsWith("[*]") ? { key: segment.slice(0, -3), each: true } : { key: segment, each: false }
    );
}

// Returns [{ value, location }] for every value found at the declared path.
export function valuesAtPath(payload, path) {
  let current = [{ value: payload, location: "$" }];
  for (const { key, each } of parsePath(path)) {
    const next = [];
    for (const { value, location } of current) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      if (!(key in value)) continue;
      const child = value[key];
      const childLocation = `${location}.${key}`;
      if (each) {
        if (!Array.isArray(child)) continue;
        child.forEach((item, index) => next.push({ value: item, location: `${childLocation}[${index}]` }));
      } else {
        next.push({ value: child, location: childLocation });
      }
    }
    current = next;
  }
  return current;
}

function walkStrings(value, location, out) {
  if (typeof value === "string") {
    out.push({ value, location });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${location}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walkStrings(child, `${location}.${key}`, out);
  }
  return out;
}

export function declaredReferencePaths(platform, kind) {
  const paths = platform?.reference_paths ?? {};
  return [...(paths._all ?? []), ...(paths[kind] ?? [])];
}

// Extracts declared references and reports every violation.
// Result: { references: [{ target, id, targetKinds, location }], errors: [{ code, location, message }] }
export function extractReferences(platform, kind, payload) {
  const references = [];
  const errors = [];
  const claimed = new Set();

  for (const declaration of declaredReferencePaths(platform, kind)) {
    for (const { value, location } of valuesAtPath(payload, declaration.path)) {
      claimed.add(location);
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        errors.push({ code: "reference.not_uuid", location, message: `Reference at ${location} is not a UUID.` });
        continue;
      }
      references.push({
        target: declaration.target,
        id: value.toLowerCase(),
        targetKinds: declaration.target_kinds ?? null,
        location,
      });
    }
  }

  const globalLocations = new Set();
  for (const path of platform?.global_identifier_paths ?? []) {
    for (const { location } of valuesAtPath(payload, path)) globalLocations.add(location);
  }

  for (const { value, location } of walkStrings(payload, "$", [])) {
    if (!UUID_PATTERN.test(value)) continue;
    if (claimed.has(location)) continue;
    if (globalLocations.has(location)) {
      errors.push({
        code: "reference.uuid_in_global_identifier",
        location,
        message: `Global identifier at ${location} must not be a tenant UUID.`,
      });
      continue;
    }
    errors.push({
      code: "reference.undeclared_uuid",
      location,
      message: `UUID-shaped value at ${location} is not at a platform-declared reference path.`,
    });
  }

  return { references, errors };
}
