"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_SUPPORT_CATEGORY,
  productScopeForProduct,
  productSupportDocumentTypeForScope,
} from "@/lib/knowledge/product-support";
import { SnippetTwoPanel } from "./SnippetTwoPanel";
import { KnowledgeDocumentEditorCard } from "./KnowledgeDocumentEditorCard";

export function KnowledgeProductDetail({ productId, productTitle }) {
  const [view, setView] = useState("document");
  const [shopId, setShopId] = useState(null);

  const productScope = productScopeForProduct({
    externalId: productId,
    title: productTitle,
  });

  const headerIcon = productTitle
    ? productTitle
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  if (view === "legacy") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => setView("document")}>
            Back to support document
          </Button>
        </div>
        <SnippetTwoPanel
          category="product-questions"
          productId={productId}
          productTitle={productTitle}
          backHref="/knowledge/product-questions"
          headerIcon={headerIcon}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">{productTitle || "Product"}</h1>
          <p className="text-sm text-muted-foreground">
            Maintain this product&apos;s support document. Legacy snippets remain available as reference.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setView("legacy")}>
          View legacy snippets
        </Button>
      </div>
      <KnowledgeDocumentEditorCard
        shopId={shopId}
        onShopId={setShopId}
        category={PRODUCT_SUPPORT_CATEGORY}
        documentType={productSupportDocumentTypeForScope(productScope)}
        title={`${productTitle || "Product"} — Product Support`}
        description="Product-specific support guide with troubleshooting sections. Draft preview only — not used in ordinary runtime."
        allowPublish={false}
      />
    </div>
  );
}
