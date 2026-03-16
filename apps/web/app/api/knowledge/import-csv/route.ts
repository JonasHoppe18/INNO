import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const SOURCE_PROVIDER = "csv_support_knowledge";
const MAX_ROWS_PER_IMPORT = 5000;

type Scope = {
  workspaceId: string | null;
  supabaseUserId: string | null;
};

type CsvBatchSummary = {
  import_id: string;
  source_file_name: string;
  imported_count: number;
  created_at: string | null;
};

type CsvImportRowPreview = {
  row_index: number;
  input_text: string;
  answer_text: string;
  topic: string | null;
  language: string | null;
  content: string;
  created_at: string | null;
};

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function normalizeWhitespace(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function detectDelimiter(raw: string) {
  const sample = String(raw || "").split(/\r?\n/).slice(0, 3).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = sample.split(candidate).length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function parseCsv(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((item) => String(item || "").trim().length > 0));
}

function sanitizeHeader(value: string, index: number) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ");
  return cleaned || `column_${index + 1}`;
}

function makeImportId() {
  try {
    return crypto.randomUUID();
  } catch (_error) {
    return `csv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function buildRowHash(parts: Array<string>) {
  return createHash("sha256")
    .update(parts.map((item) => normalizeWhitespace(item)).join("|"))
    .digest("hex");
}

function buildContent(options: {
  inputText: string;
  answerText: string;
  topic: string;
  language: string;
}) {
  const lines = [
    "Support query:",
    options.inputText,
    "",
    "Approved knowledge:",
    options.answerText,
  ];
  if (options.topic) {
    lines.push("", `Topic: ${options.topic}`);
  }
  if (options.language) {
    lines.push("", `Language: ${options.language}`);
  }
  return lines.join("\n").trim();
}

async function embedTexts(texts: string[]) {
  const inputs = Array.isArray(texts)
    ? texts.map((item) => normalizeWhitespace(item)).filter(Boolean)
    : [];
  if (!inputs.length) return [];
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing.");

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: inputs,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Embedding request failed (${response.status}).`);
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const embeddings = data
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((item) => item?.embedding)
    .filter((embedding) => Array.isArray(embedding));

  if (embeddings.length !== inputs.length) {
    throw new Error(`Embedding count mismatch: expected ${inputs.length}, got ${embeddings.length}`);
  }

  return embeddings;
}

async function resolveShop(
  serviceClient: any,
  scope: Scope,
  requestedShopId?: string,
) {
  const shop = await resolveScopedShop(serviceClient, scope, requestedShopId, {
    fields: "id, workspace_id",
    missingShopMessage: "shop_id is required for CSV knowledge import.",
  });
  return {
    shopId: String(shop.id),
    workspaceId: shop.workspace_id ? String(shop.workspace_id) : null,
  };
}

async function resolveScope(serviceClient: any) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    throw Object.assign(new Error("You must be signed in."), { status: 401 });
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    throw Object.assign(new Error("No workspace/user scope found."), { status: 400 });
  }
  return scope as Scope;
}

function getCsvValue(row: Record<string, string>, columnName: string) {
  if (!columnName) return "";
  return normalizeWhitespace(row[columnName] ?? "");
}

async function listCsvBatches(options: {
  serviceClient: any;
  shopId: string;
  workspaceId: string | null;
}) {
  let query = options.serviceClient
    .from("agent_knowledge")
    .select("metadata, created_at")
    .eq("shop_id", options.shopId)
    .eq("source_provider", SOURCE_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(8000);
  if (options.workspaceId) {
    query = query.eq("workspace_id", options.workspaceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const byImportId = new Map<string, CsvBatchSummary>();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const importId = String(metadata?.import_id || "").trim();
    if (!importId) continue;
    const existing = byImportId.get(importId);
    const createdAt = typeof row?.created_at === "string" ? row.created_at : null;

    if (!existing) {
      byImportId.set(importId, {
        import_id: importId,
        source_file_name: String(metadata?.source_file_name || "CSV Import"),
        imported_count: 1,
        created_at: createdAt,
      });
      continue;
    }

    existing.imported_count += 1;
    if (!existing.created_at || (createdAt && createdAt > existing.created_at)) {
      existing.created_at = createdAt;
    }
  }

  return Array.from(byImportId.values()).sort((a, b) => {
    const left = String(a.created_at || "");
    const right = String(b.created_at || "");
    if (left === right) return 0;
    return left > right ? -1 : 1;
  });
}

async function listCsvBatchRows(options: {
  serviceClient: any;
  shopId: string;
  workspaceId: string | null;
  importId: string;
  limit: number;
}) {
  let query = options.serviceClient
    .from("agent_knowledge")
    .select("content, metadata, created_at")
    .eq("shop_id", options.shopId)
    .eq("source_provider", SOURCE_PROVIDER)
    .eq("metadata->>import_id", options.importId)
    .order("created_at", { ascending: true })
    .limit(options.limit);
  if (options.workspaceId) {
    query = query.eq("workspace_id", options.workspaceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows: CsvImportRowPreview[] = (Array.isArray(data) ? data : []).map((row: any) => {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      row_index: Number(metadata?.row_index || 0),
      input_text: String(metadata?.input_text || ""),
      answer_text: String(metadata?.answer_text || ""),
      topic: metadata?.topic ? String(metadata.topic) : null,
      language: metadata?.language ? String(metadata.language) : null,
      content: String(row?.content || ""),
      created_at: typeof row?.created_at === "string" ? row.created_at : null,
    };
  });

  return rows.sort((a, b) => Number(a.row_index || 0) - Number(b.row_index || 0));
}

export async function GET(request: Request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveScope(serviceClient);
    const url = new URL(request.url);
    const requestedShopId = String(url.searchParams.get("shop_id") || "").trim() || undefined;
    const importId = String(url.searchParams.get("import_id") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 500));
    const shop = await resolveShop(serviceClient, scope, requestedShopId);
    if (importId) {
      const rows = await listCsvBatchRows({
        serviceClient,
        shopId: shop.shopId,
        workspaceId: shop.workspaceId,
        importId,
        limit,
      });
      return NextResponse.json({
        success: true,
        import_id: importId,
        rows,
      });
    }
    const batches = await listCsvBatches({
      serviceClient,
      shopId: shop.shopId,
      workspaceId: shop.workspaceId,
    });
    return NextResponse.json({ success: true, batches });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || "Could not load CSV imports." }, { status });
  }
}

export async function DELETE(request: Request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveScope(serviceClient);
    const payload = await request.json().catch(() => null);
    const importId = String(payload?.import_id || "").trim();
    const requestedShopId = String(payload?.shop_id || "").trim() || undefined;
    if (!importId) {
      return NextResponse.json({ error: "import_id is required." }, { status: 400 });
    }

    const shop = await resolveShop(serviceClient, scope, requestedShopId);

    let query = serviceClient
      .from("agent_knowledge")
      .delete()
      .eq("shop_id", shop.shopId)
      .eq("source_provider", SOURCE_PROVIDER)
      .eq("metadata->>import_id", importId)
      .select("id");
    if (shop.workspaceId) {
      query = query.eq("workspace_id", shop.workspaceId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, deleted: Array.isArray(data) ? data.length : 0 });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || "Could not delete CSV import." }, { status });
  }
}

export async function POST(request: Request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveScope(serviceClient);
    const formData = await request.formData();
    const requestedShopId = String(formData.get("shop_id") || "").trim() || undefined;
    const file = formData.get("file");
    const inputColumn = String(formData.get("input_column") || "").trim();
    const answerColumn = String(formData.get("answer_column") || "").trim();
    const topicColumn = String(formData.get("topic_column") || "").trim();
    const languageColumn = String(formData.get("language_column") || "").trim();
    const importId = String(formData.get("import_id") || "").trim() || makeImportId();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
    }

    const isCsvType =
      file.type === "text/csv" ||
      file.type === "application/csv" ||
      file.type === "text/plain" ||
      file.type === "application/vnd.ms-excel";
    if (!isCsvType && !file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Only CSV files are supported." }, { status: 400 });
    }

    if (!inputColumn || !answerColumn) {
      return NextResponse.json(
        { error: "input_column and answer_column are required." },
        { status: 400 },
      );
    }

    const shop = await resolveShop(serviceClient, scope, requestedShopId);
    const rawCsv = await file.text();
    const delimiter = detectDelimiter(rawCsv);
    const parsedRows = parseCsv(rawCsv, delimiter);

    if (parsedRows.length < 2) {
      return NextResponse.json({ error: "CSV must contain headers and at least one data row." }, { status: 400 });
    }

    const headers = parsedRows[0].map((header, index) => sanitizeHeader(header, index));
    if (!headers.includes(inputColumn) || !headers.includes(answerColumn)) {
      return NextResponse.json(
        { error: "Mapped columns must exist in CSV headers." },
        { status: 400 },
      );
    }

    const dataRows = parsedRows.slice(1, Math.min(parsedRows.length, MAX_ROWS_PER_IMPORT + 1));
    const preparedRows: Array<{
      source_id: string;
      chunk_index: number;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    let skippedRows = 0;
    for (let index = 0; index < dataRows.length; index += 1) {
      const values = dataRows[index];
      const record = Object.fromEntries(headers.map((header, colIndex) => [header, String(values[colIndex] || "")]));
      const inputText = getCsvValue(record, inputColumn);
      const answerText = getCsvValue(record, answerColumn);
      const topicText = getCsvValue(record, topicColumn);
      const languageText = getCsvValue(record, languageColumn);

      if (!inputText || !answerText) {
        skippedRows += 1;
        continue;
      }

      const rowIndex = index + 2;
      const rowHash = buildRowHash([inputText, answerText, topicText, languageText]);
      const content = buildContent({
        inputText,
        answerText,
        topic: topicText,
        language: languageText,
      });

      preparedRows.push({
        source_id: `csv:${importId}:row:${rowIndex}`,
        chunk_index: 0,
        content,
        metadata: {
          input_text: inputText,
          answer_text: answerText,
          topic: topicText || null,
          language: languageText || null,
          import_id: importId,
          row_index: rowIndex,
          row_hash: rowHash,
          source_file_name: file.name,
          source_kind: "csv_support_knowledge",
          trust_level: "high",
          column_mapping: {
            input_column: inputColumn,
            answer_column: answerColumn,
            topic_column: topicColumn || null,
            language_column: languageColumn || null,
          },
          chunk_index: 0,
          chunk_count: 1,
          imported_at: new Date().toISOString(),
        },
      });
    }

    if (!preparedRows.length) {
      return NextResponse.json(
        { error: "No valid rows found. Ensure mapped columns contain values." },
        { status: 400 },
      );
    }

    const embeddings = await embedTexts(preparedRows.map((row) => row.content));
    const upsertRows = preparedRows.map((row, index) => ({
      workspace_id: shop.workspaceId,
      shop_id: shop.shopId,
      source_id: row.source_id,
      chunk_index: row.chunk_index,
      content: row.content,
      source_type: "snippet",
      source_provider: SOURCE_PROVIDER,
      metadata: row.metadata,
      embedding: embeddings[index],
    }));

    const { error } = await serviceClient.from("agent_knowledge").upsert(upsertRows, {
      onConflict: "workspace_id,shop_id,source_provider,source_id,chunk_index",
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      import_id: importId,
      source_provider: SOURCE_PROVIDER,
      imported: upsertRows.length,
      skipped: skippedRows,
      total_rows: dataRows.length,
    });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error?.message || "Could not import CSV support knowledge." },
      { status },
    );
  }
}
