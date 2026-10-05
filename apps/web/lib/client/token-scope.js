// A consistency check only: the server still verifies and authorizes the JWT.
export function tokenMatchesScope(token, { userId, sessionId, orgId = null }) {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    const activeOrg = payload.org_id || payload.orgId || payload.o?.id || null;
    return payload.sub === userId && payload.sid === sessionId && activeOrg === orgId;
  } catch { return false; }
}
