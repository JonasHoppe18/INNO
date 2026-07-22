"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_SUPPORT_CATEGORY,
  productScopeForProduct,
  productSupportDocumentTypeForScope,
} from "@/lib/knowledge/product-support";
import { KnowledgeDocumentEditorCard } from "./KnowledgeDocumentEditorCard";

export function KnowledgeProductDetail({ productId, productTitle }) {
  const [shopId, setShopId] = useState(null);

  const productScope = productScopeForProduct({
    externalId: productId,
    title: productTitle,
  });

  return (
    <div className="space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <Link href="/knowledge/product-questions">
          <ArrowLeft className="h-4 w-4" />
          Back to products
        </Link>
      </Button>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight">{productTitle || "Product"}</h1>
        <p className="text-sm text-muted-foreground">
          Maintain this product&apos;s support document.
        </p>
      </div>
      <KnowledgeDocumentEditorCard
        shopId={shopId}
        onShopId={setShopId}
        category={PRODUCT_SUPPORT_CATEGORY}
        documentType={productSupportDocumentTypeForScope(productScope)}
        title={`${productTitle || "Product"} — Product Support`}
        description="Product-specific support guide with troubleshooting sections. Publish to make it live for the AI."
        helperText="Create section headings for the topics relevant to this product. Each section heading becomes a focused knowledge section for the AI."
        allowPublish={true}
      />
    </div>
  );
}
