"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function normalize(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeHeader(value, index) {
  const clean = String(value || "").replace(/\uFEFF/g, "").trim();
  return clean || `column_${index + 1}`;
}

function detectDelimiter(raw) {
  const sample = String(raw || "").split(/\r?\n/).slice(0, 3).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let score = -1;
  for (const candidate of candidates) {
    const current = sample.split(candidate).length;
    if (current > score) {
      best = candidate;
      score = current;
    }
  }
  return best;
}

function parseCsv(input, delimiter) {
  const rows = [];
  let row = [];
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

    if (char === "\r") continue;
    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((item) => String(item || "").trim().length > 0));
}

function pickHeader(headers, keywords) {
  const normalized = headers.map((header) => ({
    raw: header,
    value: String(header || "").toLowerCase(),
  }));
  for (const keyword of keywords) {
    const match = normalized.find((entry) => entry.value.includes(keyword));
    if (match?.raw) return match.raw;
  }
  return "";
}

export function CsvSupportKnowledgeImportModal({
  open,
  onOpenChange,
  shopId,
  initialFile,
  onImported,
}) {
  const [csvFile, setCsvFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [inputColumn, setInputColumn] = useState("");
  const [answerColumn, setAnswerColumn] = useState("");
  const [topicColumn, setTopicColumn] = useState("");
  const [languageColumn, setLanguageColumn] = useState("");
  const [seedFileKey, setSeedFileKey] = useState("");

  const validRowCount = useMemo(() => {
    if (!inputColumn || !answerColumn) return 0;
    let count = 0;
    for (const row of rows) {
      const inputText = normalize(row?.[inputColumn]);
      const answerText = normalize(row?.[answerColumn]);
      if (inputText && answerText) count += 1;
    }
    return count;
  }, [answerColumn, inputColumn, rows]);

  const previewRows = useMemo(() => rows.slice(0, 6), [rows]);

  const resetModal = () => {
    setCsvFile(null);
    setHeaders([]);
    setRows([]);
    setInputColumn("");
    setAnswerColumn("");
    setTopicColumn("");
    setLanguageColumn("");
    setSeedFileKey("");
    setParsing(false);
    setImporting(false);
  };

  const handleOpenChange = (nextOpen) => {
    onOpenChange(nextOpen);
    if (!nextOpen) resetModal();
  };

  const parseCsvFile = async (file) => {
    setCsvFile(file);
    setHeaders([]);
    setRows([]);
    setInputColumn("");
    setAnswerColumn("");
    setTopicColumn("");
    setLanguageColumn("");

    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file.");
      return;
    }

    setParsing(true);
    try {
      const text = await file.text();
      const delimiter = detectDelimiter(text);
      const parsed = parseCsv(text, delimiter);
      if (!parsed.length || parsed.length < 2) {
        throw new Error("CSV must contain headers and at least one row.");
      }

      const nextHeaders = parsed[0].map((header, index) => sanitizeHeader(header, index));
      const parsedRows = parsed.slice(1).map((items) =>
        Object.fromEntries(nextHeaders.map((header, index) => [header, String(items[index] || "")])),
      );

      setHeaders(nextHeaders);
      setRows(parsedRows);

      setInputColumn(
        pickHeader(nextHeaders, ["question", "customer", "issue", "problem", "title", "query"]) || nextHeaders[0],
      );
      setAnswerColumn(
        pickHeader(nextHeaders, ["answer", "reply", "response", "resolution", "content"]) || nextHeaders[1] || "",
      );
      setTopicColumn(pickHeader(nextHeaders, ["topic", "category", "tag"]));
      setLanguageColumn(pickHeader(nextHeaders, ["language", "lang", "locale"]));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse CSV.");
    } finally {
      setParsing(false);
    }
  };

  const handleCsvPicked = async (event) => {
    const file = event?.target?.files?.[0] || null;
    await parseCsvFile(file);
  };

  useEffect(() => {
    if (!open || !(initialFile instanceof File)) return;
    const nextKey = `${initialFile.name}:${initialFile.size}:${initialFile.lastModified}`;
    if (nextKey === seedFileKey) return;
    setSeedFileKey(nextKey);
    parseCsvFile(initialFile).catch(() => null);
  }, [initialFile, open, seedFileKey]);

  const handleImport = async () => {
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }
    if (!csvFile) {
      toast.error("Please select a CSV file.");
      return;
    }
    if (!inputColumn || !answerColumn) {
      toast.error("Map both the input and answer columns.");
      return;
    }
    if (!validRowCount) {
      toast.error("No valid rows found with the selected mapping.");
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("shop_id", shopId);
      formData.append("file", csvFile);
      formData.append("input_column", inputColumn);
      formData.append("answer_column", answerColumn);
      if (topicColumn) formData.append("topic_column", topicColumn);
      if (languageColumn) formData.append("language_column", languageColumn);

      const response = await fetch("/api/knowledge/import-csv", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not import CSV support knowledge.");
      }

      toast.success(`Imported ${Number(payload?.imported || 0)} rows (${Number(payload?.skipped || 0)} skipped).`);
      if (typeof onImported === "function") {
        await onImported(payload);
      }
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Support Knowledge (CSV)</DialogTitle>
          <DialogDescription>
            Upload a CSV file with approved support knowledge such as FAQs, replies, troubleshooting guides, or other
            structured support content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-support-file">CSV file</Label>
            <Input
              id="csv-support-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvPicked}
              disabled={parsing || importing}
            />
          </div>

          {headers.length > 0 ? (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="csv-input-column">Main input column</Label>
                  <select
                    id="csv-input-column"
                    value={inputColumn}
                    onChange={(event) => setInputColumn(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="">Select column</option>
                    {headers.map((header) => (
                      <option key={`input-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="csv-answer-column">Main answer/content column</Label>
                  <select
                    id="csv-answer-column"
                    value={answerColumn}
                    onChange={(event) => setAnswerColumn(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="">Select column</option>
                    {headers.map((header) => (
                      <option key={`answer-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="csv-topic-column">Topic/category (optional)</Label>
                  <select
                    id="csv-topic-column"
                    value={topicColumn}
                    onChange={(event) => setTopicColumn(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="">Not mapped</option>
                    {headers.map((header) => (
                      <option key={`topic-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="csv-language-column">Language (optional)</Label>
                  <select
                    id="csv-language-column"
                    value={languageColumn}
                    onChange={(event) => setLanguageColumn(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="">Not mapped</option>
                    {headers.map((header) => (
                      <option key={`lang-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Total rows: {rows.length}</span>
                <span>Valid rows with current mapping: {validRowCount}</span>
              </div>

              <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                <div className="grid grid-cols-12 gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <div className="col-span-5">Input</div>
                  <div className="col-span-5">Answer</div>
                  <div className="col-span-2">Topic</div>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                  {previewRows.map((row, index) => (
                    <div key={`preview-row-${index}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-gray-700">
                      <div className="col-span-5 truncate">{normalize(row?.[inputColumn]) || "-"}</div>
                      <div className="col-span-5 truncate">{normalize(row?.[answerColumn]) || "-"}</div>
                      <div className="col-span-2 truncate">{normalize(row?.[topicColumn]) || "-"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button type="button" onClick={handleImport} disabled={parsing || importing || !csvFile || !headers.length}>
            {parsing ? "Parsing..." : importing ? "Importing..." : "Start Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
