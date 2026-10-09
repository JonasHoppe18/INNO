# Workspace Brand (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can upload a logo and choose an accent color under Settings → General, stored once per workspace.

**Architecture:** Two nullable columns on `workspaces`. A `/api/settings/brand` route (GET/PUT) is included in the settings bootstrap. A `/api/settings/brand/logo` upload route reuses the public signature-image bucket under `<workspaceId>/brand/`. The General section gets a "Brand" group, saved with the existing save bar.

**Tech Stack:** Next.js 14 App Router, Supabase (service client), vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-workspace-brand-design.md`

## Global Constraints

- All defaults go to Supabase dev `zxaoycxzdjrbnzvbullk`. Never prod without an explicit "prod".
- UI copy is English only.
- `accent_color` is `null` or `#rrggbb`. `logo_url` is `null` or a public URL under `workspace-email-signature-assets/<workspaceId>/brand/`.
- Logo files are PNG/JPEG only, max 5 MB, and their magic bytes are checked (`validateEmailSignatureImage`).
- Never run `next build` against the running dev server's `.next`. Build with `NEXT_DIST_DIR`, or restart dev afterwards.

## Review Focus

- A logo URL from another workspace's brand folder must be rejected by PUT.
- A save with only a color change must not touch the logo, and the reverse.
- Discard after uploading a new logo restores the previous thumbnail. The upload is not saved until Save.
- A missing brand resource in bootstrap (e.g. a 500) must not break General. It shows empty values.
- Uppercase hex (`#FFAA00`) is accepted and stored lowercase.

---

### Task 1: Brand normalization helpers

**Files:**
- Create: `apps/web/lib/settings/brand.js`
- Test: `apps/web/lib/settings/__tests__/brand.test.js`

**Produces:** `normalizeAccentColor(value) -> string|null` (throws `Error("Accent color must be a hex color like #4f46e5.")`), `isWorkspaceBrandLogoUrl(url, { supabaseUrl, workspaceId }) -> boolean`, `brandFromPayload(payload) -> { logoUrl: string, accentColor: string }`, `brandDirty(initial, current) -> boolean`.

- [ ] Write tests: valid/uppercase/blank/invalid colors; logo URL accepted for own workspace, rejected for another workspace, another bucket, http, foreign host, path traversal (`..`); `brandFromPayload(null)` gives empty strings; `brandDirty` compares lowercase colors.
- [ ] Run `npx vitest run lib/settings/__tests__/brand.test.js`. Expected: FAIL (module missing).
- [ ] Implement.
- [ ] Re-run. Expected: PASS.
- [ ] Commit.

### Task 2: Migration (dev)

**Files:** Create `supabase/migrations/20261009120000_workspace_brand.sql`

```sql
alter table public.workspaces
  add column if not exists brand_logo_url text,
  add column if not exists brand_accent_color text;
alter table public.workspaces
  drop constraint if exists workspaces_brand_accent_color_check;
alter table public.workspaces
  add constraint workspaces_brand_accent_color_check
  check (brand_accent_color is null or brand_accent_color ~ '^#[0-9a-fA-F]{6}$');
```

- [ ] Apply to dev via the dev-write MCP `apply_migration` (name `workspace_brand`).
- [ ] Verify by querying `information_schema.columns` for both columns, and check that `update ... set brand_accent_color='red'` inside a rolled-back transaction fails.
- [ ] Commit.

### Task 3: Brand API + bootstrap

**Files:**
- Create: `apps/web/app/api/settings/brand/route.js` (GET, PUT)
- Create: `apps/web/app/api/settings/brand/logo/route.js` (POST)
- Modify: `apps/web/app/api/settings/bootstrap/route.js`, `apps/web/lib/settings/resource-map.js`, `apps/web/app/api/settings/__tests__/bootstrap.test.js`
- Test: `apps/web/app/api/settings/brand/__tests__/route.test.js`

**Consumes:** Task 1 helpers. **Produces:** GET → `{ logo_url, accent_color, workspace_found }`. PUT body `{ logo_url, accent_color }` → same shape. POST multipart `file` → `{ url }`.

- [ ] Write route tests (mock `@clerk/nextjs/server`, `@/lib/server/workspace-auth`, `@/lib/server/stateless-service-client`):
  - 401 when signed out
  - GET returns stored values
  - PUT rejects an invalid color (400) and another workspace's logo URL (400)
  - PUT stores a lowercased color and updates only the `workspaces` row of the scope
- [ ] Update the bootstrap test to expect 10 resources (mock `../brand/route`).
- [ ] Run. Expected: FAIL.
- [ ] Implement:
  - The routes follow the `test-mode` route's auth and scope pattern.
  - The logo route calls `uploadEmailSignatureImage(serviceClient, { supabaseUrl, workspaceId, userId: "brand", file })`.
  - Add `"/api/settings/brand"` to bootstrap `resources` and `SETTINGS_RESOURCE_URLS` / `WORKSPACE_ONLY_RESOURCE_URLS`.
- [ ] Run `npx vitest run app/api/settings lib/settings`. Expected: PASS.
- [ ] Commit.

### Task 4: Brand group in General

**Files:** Modify `apps/web/components/settings/sections/GeneralSection.jsx`. Optionally create `apps/web/components/settings/sections/BrandRows.jsx` if General grows past readability.

- [ ] State: `brand` / `initialBrand` from `brandFromPayload(resourcePayload(resources, "/api/settings/brand"))`. `canSave` includes `brandDirty`. Reset restores `initialBrand`.
- [ ] UI rows:
  - **Logo:** 40px-high thumbnail on a checkered/neutral background, a hidden file input with an "Upload" button and a "Remove" button.
  - **Accent color:** native `<input type="color">` (h-8 w-10) plus a hex `Input`.
  - Upload POSTs to `/api/settings/brand/logo` and sets `brand.logoUrl`. Errors are shown as a toast.
- [ ] Save: when brand is dirty, PUT `/api/settings/brand`, then `setResource("/api/settings/brand", payload)` and update `initialBrand`.
- [ ] Verify in Chrome against dev (logged-in session required):
  - upload, choose a color, Save, reload, values persist
  - Discard restores
  - Remove → Save
  - restore the original state
- [ ] `npx vitest run lib/settings app/api/settings` green. Run `next build` with `NEXT_DIST_DIR=.next-build`, and if the config doesn't honor it, restart dev afterwards.
- [ ] Commit, push, open the PR.
