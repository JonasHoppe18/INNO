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
  assert.match(importRoute, /claimQuery\.eq\("cursor", job\.cursor\)/);
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
