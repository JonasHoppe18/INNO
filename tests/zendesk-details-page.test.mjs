import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("connected Zendesk cards link to the dedicated details page", () => {
  const card = read("../apps/web/components/integrations/ZendeskConnectCard.jsx");

  assert.match(card, /href="\/integrations\/zendesk"/);
  assert.match(card, /View details/);
  assert.match(card, /<ZendeskSheet initialData=\{null\}/);
  assert.doesNotMatch(card, /\.select\("\*"\)/);
});

test("Zendesk details expose credentials, metadata, and inline sync progress", () => {
  const page = read("../apps/web/components/integrations/ZendeskDetailsPage.jsx");
  const sheet = read("../apps/web/components/integrations/ZendeskSheet.jsx");
  const importRoute = read("../apps/web/app/api/knowledge/import-zendesk/route.ts");
  const importHelpers = read("../apps/web/lib/server/zendesk-import-helpers.ts");
  const legacyImportWorker = read("../apps/web/app/api/integrations/import-history/worker/route.ts");
  const ticketExampleMigration = read("../supabase/migrations/20260715083647_add_ticket_example_conversation_context.sql");
  const importLedgerMigration = read("../supabase/migrations/20260715113222_create_knowledge_import_job_items.sql");
  const zendeskUrlHelper = read("../apps/web/lib/server/zendesk-url.ts");
  const knowledgePage = read("../apps/web/components/knowledge/KnowledgePageClient.jsx");
  const knowledgeCategories = read("../apps/web/components/knowledge/KnowledgeCategoriesClient.jsx");
  const route = read("../apps/web/app/api/integrations/zendesk/route.js");

  assert.match(page, /Credentials/);
  assert.match(page, /Integration details/);
  assert.match(page, /Sync progress/);
  assert.match(page, /Import full history/);
  assert.match(page, /\/api\/knowledge\/import-zendesk/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /has_api_token/);
  assert.doesNotMatch(route, /api_token: data\.credentials_enc/);
  assert.doesNotMatch(page, /Estimated one-time cost|estimate\.dkk|estimate\.usd/);
  assert.doesNotMatch(sheet, /Estimated one-time cost|estimate\.dkk|estimate\.usd/);
  assert.match(importRoute, /estimate: \{ ticketCount: total \}/);
  assert.match(importRoute, /const CHUNK_TICKETS = 10/);
  assert.match(importRoute, /fetchExternalWithRetry/);
  assert.match(importRoute, /retryable: true/);
  assert.match(importRoute, /lease_token: crypto\.randomUUID\(\)/);
  assert.match(importRoute, /claimQuery\.eq\("cursor", JSON\.stringify\(job\.cursor\)\)/);
  assert.match(importRoute, /\.from\("ticket_examples"\)[\s\S]*?ignoreDuplicates: false/);
  assert.match(importRoute, /\.from\("knowledge_import_job_items"\)[\s\S]*?ignoreDuplicates: true/);
  assert.match(importRoute, /external_ticket_id, tags, intent, language, csat_score/);
  assert.match(importRoute, /users\/show_many\.json/);
  assert.match(importRoute, /"page\[size\]": "100"/);
  assert.match(importRoute, /MAX_COMMENT_PAGES_PER_TICKET = 3/);
  assert.match(importRoute, /comments_over_safe_limit/);
  assert.match(importRoute, /zendeskCommentsToTurns/);
  assert.match(importRoute, /hasUnclassifiedZendeskPublicComment/);
  assert.match(importRoute, /unclassified_public_author/);
  assert.match(importRoute, /hasResidualZendeskPii/);
  assert.match(importRoute, /planZendeskRefreshCuration/);
  assert.match(importRoute, /excludeLedgeredZendeskTickets/);
  assert.match(importRoute, /Zendesk ticket export response was malformed/);
  assert.match(importRoute, /pagination was missing its next cursor/);
  assert.doesNotMatch(
    importRoute,
    /res\.json\(\)\.catch\(\(\) => \(\{ results: \[\], meta: \{\} \}\)\)/,
  );
  assert.match(importHelpers, /pair_labels_reset_v1/);
  assert.match(ticketExampleMigration, /final_agent_anchor_v1/);
  assert.match(ticketExampleMigration, /te\.source_provider <> 'zendesk'/);
  assert.match(ticketExampleMigration, /pg_catalog\.pg_extension/);
  assert.match(ticketExampleMigration, /pg_catalog\.pg_namespace/);
  assert.match(ticketExampleMigration, /query_embedding\s+%1\$I\.vector/);
  assert.match(ticketExampleMigration, /OPERATOR\(%1\$I\.<=>\)/);
  assert.equal(
    (ticketExampleMigration.match(/OPERATOR\(%1\$I\.<=>\)/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(
    ticketExampleMigration.replaceAll("OPERATOR(%1$I.<=>)", ""),
    /<=>/,
  );
  assert.match(ticketExampleMigration, /set search_path = pg_catalog/);
  assert.match(
    ticketExampleMigration,
    /drop function if exists public\.match_ticket_examples\(%I\.vector, integer, uuid, text\)/,
  );
  assert.doesNotMatch(ticketExampleMigration, /set search_path = extensions, public/);
  assert.match(importLedgerMigration, /primary key \(job_id, external_ticket_id\)/);
  assert.match(
    importLedgerMigration,
    /grant select, insert[\s\S]*?on table public\.knowledge_import_job_items[\s\S]*?to service_role/,
  );
  assert.match(importRoute, /imported_count: durableCounts\.imported/);
  assert.doesNotMatch(importRoute, /job\.imported_count \+/);
  assert.match(importRoute, /updated_count:/);
  assert.match(importRoute, /IMPORT_JOB_PROVIDER = "zendesk_ticket_examples_v2"/);
  assert.match(importRoute, /resolveRequiredTenantScope/);
  assert.match(importRoute, /requireExplicitWorkspace: true/);
  assert.match(
    importRoute,
    /!scope\?\.workspaceId && !scope\?\.supabaseUserId/,
  );
  assert.equal(
    (importRoute.match(/await resolveRequiredTenantScope\(supabase/g) ?? [])
      .length,
    3,
  );
  assert.match(importRoute, /shops\.length !== 1/);
  assert.match(importRoute, /shopId is required when multiple shops are available/);
  assert.match(importRoute, /\.select\("shop_id"\)[\s\S]*?\.in\("shop_id", shopIds\)/);
  assert.doesNotMatch(
    importRoute,
    /resolveAuthScope\([\s\S]{0,180}?\.catch\([\s\S]{0,80}?null/,
  );
  assert.match(importRoute, /normalizeZendeskBaseUrl\(configuredBaseUrl/);
  assert.match(route, /normalizeZendeskBaseUrl\(domainInput/);
  assert.ok((importRoute.match(/redirect: "error"/g) ?? []).length >= 4);
  assert.match(zendeskUrlHelper, /hostname\.endsWith\("\.zendesk\.com"\)/);
  assert.match(zendeskUrlHelper, /allowedCustomHosts/);
  assert.match(zendeskUrlHelper, /parsed\.protocol !== "https:"/);
  assert.ok(
    (importRoute.match(/\.eq\("provider", IMPORT_JOB_PROVIDER\)/g) ?? [])
        .length >= 7,
  );
  assert.match(legacyImportWorker, /\.in\("provider", LEGACY_HISTORY_PROVIDERS\)/);
  assert.match(page, /Refreshed/);
  assert.match(sheet, /refreshed/);
  assert.match(importRoute, /\/api\/v2\/search\/export\?/);
  assert.match(importRoute, /"filter\[type\]": "ticket"/);
  assert.doesNotMatch(importRoute, /tickets\.json\?status=/);
  assert.match(knowledgePage, /Manage ticket import/);
  assert.match(knowledgeCategories, /href="\/integrations\/zendesk"/);
  assert.doesNotMatch(knowledgePage, /handleZendeskImport/);
  assert.doesNotMatch(knowledgeCategories, /handleImportTickets/);

  const startMode = importRoute.indexOf('if (mode === "start")');
  const continueMode = importRoute.indexOf('if (mode === "continue")');
  const startResponse = importRoute.indexOf("Starting is intentionally cheap");
  assert.ok(startMode >= 0 && startResponse > startMode && continueMode > startResponse);
});
