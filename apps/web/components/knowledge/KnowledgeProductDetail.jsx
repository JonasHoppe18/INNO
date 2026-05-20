"use client";

import { SnippetTwoPanel } from "./SnippetTwoPanel";

export function KnowledgeProductDetail({ productId, productTitle }) {
  return (
    <SnippetTwoPanel
      category="product-questions"
      productId={productId}
      productTitle={productTitle}
      backHref="/knowledge/product-questions"
      headerIcon={productTitle
        ? productTitle
            .split(/\s+/)
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2)
        : "?"}
    />
  );
}
