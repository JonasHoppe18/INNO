"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
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
    <div className="space-y-5">
      <nav aria-label="Knowledge breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/knowledge" className="transition-colors hover:text-foreground">
          Knowledge
        </Link>
        <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
        <Link href="/knowledge/product-questions" className="transition-colors hover:text-foreground">
          Product Questions
        </Link>
        <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
        <span className="max-w-[18rem] truncate font-medium text-foreground">
          {productTitle || "Product"}
        </span>
      </nav>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">{productTitle || "Product"}</h1>
          <p className="text-sm text-muted-foreground">
            Maintain this product&apos;s support document.
          </p>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-mr-2 hidden shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"
        >
          <Link href="/knowledge/product-questions">
            <ArrowLeft className="size-3.5" />
            Back to products
          </Link>
        </Button>
      </div>
      <KnowledgeDocumentEditorCard
        shopId={shopId}
        onShopId={setShopId}
        category={PRODUCT_SUPPORT_CATEGORY}
        documentType={productSupportDocumentTypeForScope(productScope)}
        title={`${productTitle || "Product"} — Product Support`}
        description="Product-specific support guide with troubleshooting sections. Publish to make it live for the AI."
        helperText="Create section headings for the topics relevant to this product. Each section heading becomes a focused knowledge section for the AI."
        scopeLabel="Product-specific"
        scopeValue={productTitle || "This product"}
        allowPublish={true}
      />
    </div>
  );
}
