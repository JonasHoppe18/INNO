# Sona CSAT email builder

This feature adds a workspace-scoped drag-and-drop CSAT email builder at
`/settings/csat/email`, with grouped Thank You pages at
`/settings/csat/thank-you`.

## Architecture

```text
Sona settings UI
      |
      v
Templatical editor (JSON source of truth)
      |  save draft / preview / publish / test
      v
Next.js CSAT API routes ---- workspace-auth ---- Supabase service client
      |                                          |
      |                                          +-- csat_email_templates
      |                                          +-- csat_email_template_versions
      |                                          +-- csat_thank_you_configs
      |                                          +-- csat_survey_tokens
      |
      +-- Templatical JSON -> MJML -> HTML + plain text
      |                                      |
      |                                      +-- Postmark test send
      |                                      +-- Postmark published survey send
      |
Customer rating link -> /csat/respond/{token}?score=1..5
      |
      +-- hash token -> validate workspace/thread -> support_feedback
                                      |
                                      +-- negative / neutral / positive Thank You page
```

The repository did not contain a current CSAT survey-send trigger or a
separate CSAT token implementation. Existing CSAT analytics already read
`public.support_feedback`, so the response handler writes to that table and
`sendPublishedCsatSurveyEmail` is the reusable integration point for the
future/current survey trigger. The existing email flows remain unchanged.

## Dependency decision

The implementation uses the pinned `@templatical/editor@0.34.3`,
`@templatical/renderer@0.34.3`, and `@templatical/types@0.34.3` packages, plus
`mjml@5.4.0` for server-side HTML compilation.

Templatical is framework-agnostic at the mount boundary: its Vue editor is
initialized against an HTMLElement, emits JSON through `onChange`, supports
custom blocks/merge tags, and can export JSON to MJML. Its editor package is
licensed FSL-1.1-MIT; the license FAQ permits embedding in a commercial SaaS,
CRM, or transactional product, provided the product is not itself a competing
email editor. Renderer and types are MIT-licensed.

The optional media-library and quality peers were deliberately not installed:
their current releases require Tailwind 4, while Sona currently uses Tailwind
3. The Next webpack aliases leave those unused optional features out of the
bundle. Images are URL-based in this first slice; uploads can be added later
behind an explicit workspace-scoped media provider.

References:

- [Templatical SDK](https://github.com/templatical/sdk)
- [Rendering documentation](https://docs.templatical.com/getting-started/how-rendering-works)
- [Custom blocks](https://docs.templatical.com/guide/custom-blocks)
- [License FAQ](https://docs.templatical.com/license-faq)

## Editable template and blocks

`apps/web/lib/csat/email-template.js` defines the controlled template surface:

- built-in palette: section/columns, title, paragraph, image, button, divider,
  and spacer;
- custom `csat-rating` block with question, fixed scale 5, emoji/numbers/stars,
  alignment, colors, and size;
- controlled merge tags for customer, store, conversation, order, and CSAT
  rating URLs;
- realistic preview data for Alex, Demo Store, Sona, and order `#1054`.

The server normalizer in `apps/web/lib/server/csat-email.js` whitelists block
types and fields, caps nesting/lengths, validates colors and URLs, rejects
scripts/iframes/forms/event handlers, and rejects unknown variables. It never
evaluates arbitrary Liquid or JavaScript. Missing optional values render as an
empty string.

## Rendering pipeline

The editor, preview API, test-send API, and published-send helper all use
`renderCsatEmail`:

1. normalize and validate the editable JSON;
2. substitute only the allowlisted variables;
3. generate secure score URLs for live sends, or inert markers/anchors for
   preview and test sends;
4. render Templatical JSON to MJML, including the Sona CSAT block;
5. compile MJML to email-safe HTML;
6. validate the generated HTML and derive a plain-text fallback.

Live URLs use a random 32-byte token. Only its SHA-256 hash is stored. The
token is scoped to a workspace and conversation and is never created for a
test send. A test email has `#sona-csat-test-score-N` links, an internal test
tag/metadata marker, and no public response URL.

## Persistence and lifecycle

The migration `supabase/migrations/20260910000000_create_csat_email_builder.sql`
is additive and has not been executed against production.

- `csat_email_templates` stores one editable draft per workspace and caches the
  last rendered HTML/text.
- `csat_email_template_versions` stores immutable published snapshots and
  retains older versions as `archived`; one published version is enforced per
  workspace.
- `csat_thank_you_configs` stores grouped response copy as JSON so future
  per-score overrides can be added without replacing the table.
- `csat_survey_tokens` stores only hashed live-survey tokens and their
  workspace/conversation relation.

Normal saves set the template to `draft`. Publishing archives the previous
published version, inserts a new version, and then marks the workspace draft
as the new published version. Actual survey sends must load the published
version, never the draft.

Every server-side template query includes `workspace_id` in addition to the
database RLS policies. The settings routes resolve the workspace from the
authenticated Clerk user/org using the existing `resolveAuthScope` helper.
Token rows are service-role-only; the public response page receives only the
opaque token and score.

## Thank You flow

`apps/web/components/csat/CsatThankYouSettings.jsx` edits three generic groups:

- negative: scores 1–2;
- neutral: score 3;
- positive: scores 4–5.

After a live click, `recordCsatResponse` validates the token and score, writes
the existing `support_feedback` row, selects the group, loads workspace copy,
and renders the branded response page. The editor does not contain response
handling logic.

## Adding a new block

1. Add its palette name and any custom definition in
   `apps/web/lib/csat/email-template.js`.
2. Add its allowed fields and safe normalization branch in
   `apps/web/lib/server/csat-email.js`.
3. Add a renderer-supported representation or a server custom-block renderer.
4. Keep URLs, colors, text lengths, and markup allowlisted.
5. Add preview, missing-data, unsafe-input, and rendered-HTML tests before
   exposing the block in the palette.

Do not add unrestricted HTML, script, iframe, form, or arbitrary template-code
execution to the email surface.

## Verification

The focused CSAT test suite covers workspace scoping, draft/published state,
published loading, variables and missing data, five score links, invalid
scores, secure live tokens, Thank You grouping, script rejection, and the
test-mode response guard. The migration is repository-only; no production
migration or deployment is part of this feature branch.
