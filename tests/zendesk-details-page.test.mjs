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
});
