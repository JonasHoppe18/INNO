import Link from "next/link";
import { ChevronRightIcon, RadarIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RADAR_STATUS_BADGE, RADAR_STATUS_LABEL, describeRadarSignal, productRadarHref } from "@/lib/product-radar-copy";

const MAX_ALERTS = 3;

// Rendered only when at least one product has a spike or a rising trend.
export function ProductAlertsCard({ alerts = [] }) {
  if (!alerts.length) return null;
  const shown = alerts.slice(0, MAX_ALERTS);
  const hidden = alerts.length - shown.length;

  return (
    <Card className="rounded-2xl border-border/70 shadow-sm">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <RadarIcon className="size-4" />
            </div>
            <div>
              <CardTitle>Product alerts</CardTitle>
              <CardDescription className="mt-1">Products with unusual customer contact.</CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="rounded-lg px-2" asChild>
            <Link href={productRadarHref()}>
              {hidden > 0 ? `View all ${alerts.length}` : "View products"}
              <ChevronRightIcon className="ml-1 size-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 p-5 pt-0 md:grid-cols-3">
        {shown.map((row) => (
          <Link
            key={row.productId}
            href={productRadarHref(row.productId)}
            className="rounded-xl border border-border/70 px-4 py-3 transition-colors duration-150 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <Badge variant={RADAR_STATUS_BADGE[row.status]} className="shrink-0">{RADAR_STATUS_LABEL[row.status]}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{describeRadarSignal(row)}</p>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
