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
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <Link href="/knowledge/product-questions">
          <ArrowLeft data-icon="inline-start" />
          Back to products
        </Link>
      </Button>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{productTitle || "Product"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Maintain the product-specific knowledge Sona uses when helping customers.
        </p>
      </div>
      <KnowledgeDocumentEditorCard
        shopId={shopId}
        onShopId={setShopId}
        category={PRODUCT_SUPPORT_CATEGORY}
        documentType={productSupportDocumentTypeForScope(productScope)}
        title={`${productTitle || "Product"} — Product Support`}
        helperText="Create section headings for the topics relevant to this product. Each section heading becomes a focused knowledge section for the AI."
        allowPublish={true}
      />
    </div>
  );
}
