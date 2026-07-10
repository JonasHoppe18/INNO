import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("product support documents provide a direct way back to the product list", () => {
  const detail = read("../apps/web/components/knowledge/KnowledgeProductDetail.jsx");

  assert.match(detail, /import Link from "next\/link"/);
  assert.match(detail, /href="\/knowledge\/product-questions"/);
  assert.match(detail, /Back to products/);
});
