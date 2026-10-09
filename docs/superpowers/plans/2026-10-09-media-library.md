# Media Library (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-workspace image library: upload once, then pick the image in both email designers and on the Brand page.

**Architecture:**
- The `workspace_media` table holds one row per image, and the files live in the public bucket under `<ws>/media/`.
- Pure file helpers handle type and dimensions. A server module does list, upload, soft-delete and lookup, behind the `/api/media` routes.
- A `MediaPicker` dialog with a promise-based provider is used by `EmailTemplateBuilder.onRequestMedia` and by the Brand page.

**Tech Stack:** Next.js 14, Supabase, vitest, Templatical editor 0.34.3.

**Spec:** `docs/superpowers/specs/2026-10-09-brand-in-designers-design.md` (section B1)

## Global Constraints

- Dev only (`zxaoycxzdjrbnzvbullk`). Prod migration only on an explicit "prod".
- Types: PNG, JPEG and GIF, with magic bytes checked. SVG and WebP are rejected. Max 5,242,880 bytes. Warn above 1 MB.
- Every query filters on `workspace_id` from the auth scope. A foreign id returns 404.
- Delete is soft (`deleted_at`). Files are never removed.
- UI copy is English.

## Review Focus

- A `brand_logo_url` that points at a soft-deleted or foreign media row must be rejected on save.
- A GIF with a PNG content type, or the reverse, must be rejected.
- Pagination with equal `created_at` values must not skip or repeat items. Order by `(created_at desc, id desc)` and paginate by `created_at` + `id`.
- Cancelling the picker from the editor must leave the image block unchanged (resolve `null`).
- The backfill must not duplicate rows when the migration is re-run (`on conflict (storage_path) do nothing`).

---

### Task 1: File helpers
- Create `apps/web/lib/media/image-files.js`:
  - `detectImageType(bytes) -> "image/png"|"image/jpeg"|"image/gif"|null`
  - `validateMediaFile({ contentType, bytes }) -> { contentType, extension }` (throws with `status: 400`)
  - `readImageDimensions(bytes, contentType) -> { width, height } | null`
  - `MEDIA_MAX_BYTES`, `MEDIA_WARN_BYTES`
- Tests in `apps/web/lib/media/__tests__/image-files.test.js`, using generated PNG, GIF and JPEG (SOF0 and SOF2) byte fixtures. Write them first (RED), then implement (GREEN). Commit.

### Task 2: Migration (dev)
- `supabase/migrations/20261009150000_workspace_media.sql`:
  - the table and partial index from the spec
  - RLS with a member select policy
  - a backfill of brand logos from `workspaces.brand_logo_url` joined to `storage.objects` (bucket `workspace-email-signature-assets`, name = path after `/public/<bucket>/`), with `on conflict do nothing`
- Apply on dev and verify the table, policy and backfilled row for Morrow Home. Commit.

### Task 3: Server module + routes
- `apps/web/lib/server/workspace-media.js`:
  - `listWorkspaceMedia(client, workspaceId, { before })` (the cursor `before` = `"<iso>|<id>"`)
  - `uploadWorkspaceMedia(client, { supabaseUrl, workspaceId, userId, file })`
  - `softDeleteWorkspaceMedia(client, workspaceId, id) -> boolean`
  - `findActiveWorkspaceMediaByUrl(client, workspaceId, url)`
- Routes:
  - `app/api/media/route.js` (GET, POST)
  - `app/api/media/[id]/route.js` (DELETE)
- Tests with a fake client: 401, scoped list, cursor, upload path `<ws>/media/`, foreign delete 404, soft delete. RED → GREEN. Commit.

### Task 4: Brand uses the library
- `/api/settings/brand` PUT: the logo must be found by `findActiveWorkspaceMediaByUrl`. Otherwise 400.
- Remove `app/api/settings/brand/logo/route.js` and `isWorkspaceBrandLogoUrl`, and update the brand tests. RED → GREEN. Commit.

### Task 5: MediaPicker UI + wiring
- `components/media/MediaPicker.jsx`:
  - `MediaPickerProvider` and `useMediaPicker().openMediaPicker()`
  - a dialog with a grid, upload button and drop zone, delete menu, load more, a warning above 1 MB, and an empty state
- Wiring:
  - wrap `EmailTemplateBuilder` (or its page) in the provider
  - `onRequestMedia` calls `openMediaPicker` and returns `{ url, alt }`, or `null`
  - the Brand page gets a "Choose logo" button
  - the provider is placed in `SettingsWorkspace`
- Verify in Chrome per the spec, then run `next build` and restart dev. Commit, push and open the PR.
